(() => {
    'use strict';

    const DAY_WIDTH = 32;
    const WEEK_WIDTH = 96;
    const MAX_TASKS = 100;
    const TASK_HEIGHT = 48;
    const GROUP_SUMMARY_HEIGHT = 32;

    const state = {
        tasks: [],
        groups: [],
        dependencies: [],
        baselines: [],
        selectedBaselineId: null,
        statsCollapsed: false,
        projectStart: new Date(),
        selectedTaskId: null,
        selectedDepId: null,
        isResourceView: false,
        preBalanceState: null,
        dragState: null,
        depDragState: null,
        idCounter: 1,
        currentView: 'day',
        listSortField: null,
        listSortDirection: 'asc',
        printPreviewState: {
            currentPage: 1,
            totalPages: 1,
            pages: []
        }
    };

    const utils = {
        uid() {
            return 'id_' + (state.idCounter++);
        },

        syncIdCounter() {
            let maxId = 0;
            state.tasks.forEach(t => {
                const m = /id_(\d+)/.exec(t.id);
                if (m) {
                    const n = parseInt(m[1]);
                    if (n > maxId) maxId = n;
                }
            });
            state.dependencies.forEach(d => {
                const m = /id_(\d+)/.exec(d.id);
                if (m) {
                    const n = parseInt(m[1]);
                    if (n > maxId) maxId = n;
                }
            });
            state.groups.forEach(g => {
                const m = /id_(\d+)/.exec(g.id);
                if (m) {
                    const n = parseInt(m[1]);
                    if (n > maxId) maxId = n;
                }
            });
            state.baselines.forEach(b => {
                const m = /id_(\d+)/.exec(b.id);
                if (m) {
                    const n = parseInt(m[1]);
                    if (n > maxId) maxId = n;
                }
            });
            state.idCounter = maxId + 1;
        },

        addDays(date, days) {
            const d = new Date(date);
            d.setDate(d.getDate() + days);
            return d;
        },

        diffDays(date1, date2) {
            const d1 = new Date(date1);
            const d2 = new Date(date2);
            d1.setHours(0, 0, 0, 0);
            d2.setHours(0, 0, 0, 0);
            return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
        },

        formatDate(date) {
            const d = new Date(date);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        },

        formatDateTime(date) {
            const d = new Date(date);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        },

        showToast(msg, type = 'info') {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.className = 'toast show';
            if (type === 'error') toast.classList.add('error');
            if (type === 'success') toast.classList.add('success');
            setTimeout(() => {
                toast.className = 'toast';
            }, 2500);
        },

        flashScreen() {
            const overlay = document.getElementById('flash-overlay');
            overlay.classList.add('active');
            setTimeout(() => overlay.classList.remove('active'), 150);
        },

        clamp(val, min, max) {
            return Math.max(min, Math.min(max, val));
        },

        getEffectiveDuration(task) {
            return task.type === 'milestone' ? 0 : (task.duration || 1);
        },

        getWeekNumber(date) {
            const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        },

        getWeekStart(date) {
            const d = new Date(date);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            d.setDate(diff);
            d.setHours(0, 0, 0, 0);
            return d;
        },

        getWeekEnd(date) {
            const start = this.getWeekStart(date);
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            return end;
        },

        diffWeeks(date1, date2) {
            const w1 = this.getWeekStart(date1);
            const w2 = this.getWeekStart(date2);
            return Math.round((w2 - w1) / (7 * 24 * 60 * 60 * 1000));
        },

        snapToWeek(day) {
            const date = this.addDays(state.projectStart, day);
            const weekStart = this.getWeekStart(date);
            return this.diffDays(state.projectStart, weekStart);
        },

        formatWeekRange(date) {
            const start = this.getWeekStart(date);
            const end = this.getWeekEnd(date);
            const weekNum = this.getWeekNumber(start);
            const m1 = start.getMonth() + 1;
            const d1 = start.getDate();
            const m2 = end.getMonth() + 1;
            const d2 = end.getDate();
            return `第${weekNum}周 ${m1}/${d1}-${m2}/${d2}`;
        },

        getWeekLabel(date) {
            const weekNum = this.getWeekNumber(date);
            const start = this.getWeekStart(date);
            const end = this.getWeekEnd(date);
            return {
                weekNum,
                startLabel: `${start.getMonth() + 1}/${start.getDate()}`,
                endLabel: `${end.getMonth() + 1}/${end.getDate()}`
            };
        },

        getTaskStatus(task) {
            if (task.progress >= 100) return 'completed';
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayDay = this.diffDays(state.projectStart, today);
            const endDay = task._startDay + (task.duration || 0);
            if (todayDay > endDay) return 'lagging';
            return 'inprogress';
        },

        getPredecessorNames(taskId) {
            const preds = state.dependencies.filter(d => d.to === taskId);
            return preds.map(d => {
                const t = state.tasks.find(x => x.id === d.from);
                return t ? t.name : '';
            }).filter(Boolean).join(', ');
        }
    };

    const statsManager = {
        toggleStats() {
            state.statsCollapsed = !state.statsCollapsed;
            const toggle = document.querySelector('.stats-toggle');
            const content = document.getElementById('stats-content');
            if (toggle) toggle.classList.toggle('collapsed', state.statsCollapsed);
            if (content) content.classList.toggle('collapsed', state.statsCollapsed);
        },

        updateStats() {
            const tasks = state.tasks.filter(t => t.type !== 'milestone');
            const totalDuration = tasks.reduce((sum, t) => sum + (t.duration || 0), 0);
            let weightedProgress = 0;
            if (totalDuration > 0) {
                weightedProgress = tasks.reduce((sum, t) => sum + (t.progress || 0) * (t.duration || 0), 0) / totalDuration;
            }

            const completionEl = document.getElementById('stats-completion');
            const progressFillEl = document.getElementById('stats-progress-fill');
            if (completionEl) completionEl.textContent = Math.round(weightedProgress) + '%';
            if (progressFillEl) progressFillEl.style.width = Math.round(weightedProgress) + '%';

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayDay = utils.diffDays(state.projectStart, today);
            let laggingCount = 0;
            state.tasks.forEach(t => {
                if (t.type === 'milestone') return;
                const endDay = t._startDay + (t.duration || 0);
                if (todayDay > t._startDay && (t.progress || 0) < 100) {
                    laggingCount++;
                }
            });

            const laggingEl = document.getElementById('stats-lagging');
            if (laggingEl) laggingEl.textContent = laggingCount + ' 个';

            const baselineItems = document.querySelectorAll('.stats-baseline');
            if (state.selectedBaselineId) {
                baselineItems.forEach(el => el.style.display = '');
                this.updateBaselineStats();
            } else {
                baselineItems.forEach(el => el.style.display = 'none');
            }
        },

        updateBaselineStats() {
            if (!state.selectedBaselineId) return;

            const baseline = state.baselines.find(b => b.id === state.selectedBaselineId);
            if (!baseline) return;

            let totalDeviation = 0;
            let count = 0;
            let maxDeviation = 0;
            let maxDeviationTaskName = '';

            baseline.tasks.forEach(bt => {
                const task = state.tasks.find(t => t.id === bt.id);
                if (task) {
                    const deviation = task._startDay - bt.startDay;
                    totalDeviation += deviation;
                    count++;
                    if (Math.abs(deviation) > Math.abs(maxDeviation)) {
                        maxDeviation = deviation;
                        maxDeviationTaskName = task.name;
                    }
                }
            });

            const avgDeviation = count > 0 ? (totalDeviation / count).toFixed(1) : 0;

            const avgEl = document.getElementById('stats-avg-deviation');
            const maxEl = document.getElementById('stats-max-deviation');

            if (avgEl) {
                avgEl.textContent = avgDeviation + ' 天';
                avgEl.style.color = avgDeviation > 0 ? '#f56c6c' : (avgDeviation < 0 ? '#67c23a' : '#303133');
            }
            if (maxEl) {
                if (maxDeviationTaskName) {
                    maxEl.textContent = `${maxDeviationTaskName} (${maxDeviation > 0 ? '+' : ''}${maxDeviation}天)`;
                    maxEl.style.color = maxDeviation > 0 ? '#f56c6c' : (maxDeviation < 0 ? '#67c23a' : '#303133');
                } else {
                    maxEl.textContent = '-';
                }
            }
        }
    };

    const baselineManager = {
        MAX_BASELINES: 3,

        saveBaseline(name) {
            if (state.baselines.length >= this.MAX_BASELINES) {
                utils.showToast(`最多只能保存 ${this.MAX_BASELINES} 份基线`, 'error');
                return null;
            }

            const baselineTasks = state.tasks.map(t => ({
                id: t.id,
                startDay: t._startDay,
                duration: t.type === 'milestone' ? 0 : t.duration,
                type: t.type
            }));

            const baseline = {
                id: utils.uid(),
                name: name || `基线 ${state.baselines.length + 1}`,
                savedAt: new Date().toISOString(),
                tasks: baselineTasks
            };

            state.baselines.push(baseline);
            this.renderBaselineList();
            utils.showToast('基线保存成功', 'success');
            return baseline;
        },

        deleteBaseline(baselineId) {
            if (!confirm('确定删除此基线？')) return;
            state.baselines = state.baselines.filter(b => b.id !== baselineId);
            if (state.selectedBaselineId === baselineId) {
                state.selectedBaselineId = null;
            }
            this.renderBaselineList();
            renderer.renderAll();
            statsManager.updateStats();
            utils.showToast('基线已删除', 'success');
        },

        selectBaseline(baselineId) {
            if (state.selectedBaselineId === baselineId) {
                state.selectedBaselineId = null;
            } else {
                state.selectedBaselineId = baselineId;
            }
            this.renderBaselineList();
            renderer.renderAll();
            statsManager.updateStats();
        },

        getBaselineTask(baselineId, taskId) {
            const baseline = state.baselines.find(b => b.id === baselineId);
            if (!baseline) return null;
            return baseline.tasks.find(t => t.id === taskId) || null;
        },

        getTaskDeviation(taskId) {
            if (!state.selectedBaselineId) return 0;
            const baselineTask = this.getBaselineTask(state.selectedBaselineId, taskId);
            if (!baselineTask) return null;
            const task = state.tasks.find(t => t.id === taskId);
            if (!task) return null;
            return task._startDay - baselineTask.startDay;
        },

        renderBaselineList() {
            const list = document.getElementById('baseline-list');
            if (!list) return;

            if (state.baselines.length === 0) {
                list.innerHTML = '<div class="baseline-empty">暂无基线，点击上方按钮保存</div>';
                return;
            }

            list.innerHTML = '';
            state.baselines.forEach(baseline => {
                const item = document.createElement('div');
                item.className = 'baseline-item';
                if (baseline.id === state.selectedBaselineId) {
                    item.classList.add('active');
                }
                item.dataset.id = baseline.id;

                const info = document.createElement('div');
                info.className = 'baseline-item-info';

                const name = document.createElement('div');
                name.className = 'baseline-item-name';
                name.textContent = baseline.name;
                info.appendChild(name);

                const time = document.createElement('div');
                time.className = 'baseline-item-time';
                time.textContent = utils.formatDateTime(new Date(baseline.savedAt));
                info.appendChild(time);

                item.appendChild(info);

                const delBtn = document.createElement('span');
                delBtn.className = 'baseline-item-delete';
                delBtn.title = '删除基线';
                delBtn.innerHTML = '×';
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteBaseline(baseline.id);
                });
                item.appendChild(delBtn);

                item.addEventListener('click', () => {
                    this.selectBaseline(baseline.id);
                });

                list.appendChild(item);
            });
        }
    };

    const groupManager = {
        addGroup(name) {
            const group = {
                id: utils.uid(),
                name: name || `分组 ${state.groups.length + 1}`,
                collapsed: false
            };
            state.groups.push(group);
            renderer.renderAll();
            return group;
        },

        deleteGroup(groupId) {
            if (!confirm('确定删除此分组？组内任务将变为无分组状态。')) return;
            state.tasks.forEach(t => {
                if (t.groupId === groupId) {
                    t.groupId = null;
                }
            });
            state.groups = state.groups.filter(g => g.id !== groupId);
            renderer.renderAll();
        },

        toggleGroup(groupId) {
            const group = state.groups.find(g => g.id === groupId);
            if (group) {
                group.collapsed = !group.collapsed;
                renderer.renderAll();
            }
        },

        renameGroup(groupId, name) {
            const group = state.groups.find(g => g.id === groupId);
            if (group) {
                group.name = name || '未命名分组';
                renderer.renderGantt();
            }
        },

        moveTaskToGroup(taskId, groupId) {
            const task = state.tasks.find(t => t.id === taskId);
            if (task) {
                task.groupId = groupId;
                renderer.renderAll();
            }
        },

        getGroupTasks(groupId) {
            return state.tasks.filter(t => t.groupId === groupId);
        },

        getUngroupedTasks() {
            return state.tasks.filter(t => !t.groupId);
        },

        getGroupTimeRange(groupId) {
            const tasks = this.getGroupTasks(groupId);
            if (tasks.length === 0) return null;
            let minStart = Infinity;
            let maxEnd = -Infinity;
            tasks.forEach(t => {
                const duration = utils.getEffectiveDuration(t);
                if (t._startDay < minStart) minStart = t._startDay;
                if (t._startDay + duration > maxEnd) maxEnd = t._startDay + duration;
            });
            return { start: minStart, end: maxEnd };
        }
    };

    const scheduler = {
        topologicalSort() {
            const inDegree = {};
            const adj = {};
            state.tasks.forEach(t => {
                inDegree[t.id] = 0;
                adj[t.id] = [];
            });
            state.dependencies.forEach(dep => {
                if (inDegree[dep.to] !== undefined) {
                    inDegree[dep.to]++;
                    adj[dep.from].push(dep.to);
                }
            });
            const queue = [];
            const result = [];
            Object.keys(inDegree).forEach(id => {
                if (inDegree[id] === 0) queue.push(id);
            });
            while (queue.length) {
                const id = queue.shift();
                result.push(id);
                adj[id].forEach(next => {
                    inDegree[next]--;
                    if (inDegree[next] === 0) queue.push(next);
                });
            }
            return result.length === state.tasks.length ? result : null;
        },

        detectCycle() {
            const WHITE = 0, GRAY = 1, BLACK = 2;
            const color = {};
            const adj = {};
            state.tasks.forEach(t => {
                color[t.id] = WHITE;
                adj[t.id] = [];
            });
            state.dependencies.forEach(dep => {
                if (adj[dep.from]) adj[dep.from].push(dep.to);
            });
            let cyclePath = null;
            const dfs = (u, path) => {
                color[u] = GRAY;
                path.push(u);
                for (const v of adj[u]) {
                    if (color[v] === GRAY) {
                        const idx = path.indexOf(v);
                        cyclePath = path.slice(idx);
                        cyclePath.push(v);
                        return true;
                    }
                    if (color[v] === WHITE) {
                        if (dfs(v, path)) return true;
                    }
                }
                path.pop();
                color[u] = BLACK;
                return false;
            };
            for (const t of state.tasks) {
                if (color[t.id] === WHITE) {
                    if (dfs(t.id, [])) break;
                }
            }
            return cyclePath;
        },

        detectCycleWithNewDep(fromId, toId) {
            const tempDep = { id: 'temp', from: fromId, to: toId };
            state.dependencies.push(tempDep);
            const cycle = this.detectCycle();
            state.dependencies.pop();
            return cycle;
        },

        calculateSchedule() {
            const order = this.topologicalSort();
            if (!order) return false;
            const taskMap = {};
            state.tasks.forEach(t => { taskMap[t.id] = t; });
            order.forEach(id => {
                const task = taskMap[id];
                const effDuration = utils.getEffectiveDuration(task);
                let earliestDay = 0;
                if (task.earliestStartDate && task.type !== 'milestone') {
                    earliestDay = Math.max(0, utils.diffDays(state.projectStart, new Date(task.earliestStartDate)));
                }
                const preds = state.dependencies.filter(d => d.to === id);
                preds.forEach(dep => {
                    const predTask = taskMap[dep.from];
                    if (predTask) {
                        const predDuration = utils.getEffectiveDuration(predTask);
                        const predEnd = predTask._startDay + predDuration;
                        if (predEnd > earliestDay) earliestDay = predEnd;
                    }
                });
                task._startDay = Math.max(0, earliestDay);
            });
            this.calculateCriticalPath();
            return true;
        },

        calculateCriticalPath() {
            const taskMap = {};
            state.tasks.forEach(t => {
                const effDuration = utils.getEffectiveDuration(t);
                t._endDay = t._startDay + effDuration;
                t._isCritical = false;
                taskMap[t.id] = t;
            });
            const successors = {};
            state.tasks.forEach(t => { successors[t.id] = []; });
            state.dependencies.forEach(dep => {
                if (successors[dep.from] && taskMap[dep.to]) {
                    successors[dep.from].push(dep.to);
                }
            });
            let maxEnd = 0;
            state.tasks.forEach(t => {
                if (t._endDay > maxEnd) maxEnd = t._endDay;
            });
            const latestStart = {};
            state.tasks.forEach(t => { latestStart[t.id] = maxEnd; });
            const order = this.topologicalSort();
            if (!order) return;
            const revOrder = order.reverse();
            revOrder.forEach(id => {
                const effDuration = utils.getEffectiveDuration(taskMap[id]);
                if (successors[id].length === 0) {
                    latestStart[id] = maxEnd - effDuration;
                } else {
                    let minSucc = Infinity;
                    successors[id].forEach(s => {
                        if (latestStart[s] < minSucc) minSucc = latestStart[s];
                    });
                    latestStart[id] = minSucc - effDuration;
                }
                if (Math.abs(latestStart[id] - taskMap[id]._startDay) < 0.5) {
                    taskMap[id]._isCritical = true;
                }
            });
            state.tasks.forEach(t => {
                if (t._endDay === maxEnd && successors[t.id].length === 0) {
                    t._isCritical = true;
                }
            });
        }
    };

    const resourceManager = {
        findConflicts() {
            const conflicts = {};
            const byAssignee = {};
            state.tasks.forEach(t => {
                if (t.type === 'milestone') return;
                if (t.assignee && t.assignee.trim()) {
                    const a = t.assignee.trim();
                    if (!byAssignee[a]) byAssignee[a] = [];
                    byAssignee[a].push(t);
                }
            });
            Object.keys(byAssignee).forEach(assignee => {
                const tasks = byAssignee[assignee];
                for (let i = 0; i < tasks.length; i++) {
                    for (let j = i + 1; j < tasks.length; j++) {
                        const t1 = tasks[i], t2 = tasks[j];
                        const overlap = !(t1._endDay <= t2._startDay || t2._endDay <= t1._startDay);
                        if (overlap) {
                            if (!conflicts[t1.id]) conflicts[t1.id] = [];
                            if (!conflicts[t2.id]) conflicts[t2.id] = [];
                            conflicts[t1.id].push(t2.id);
                            conflicts[t2.id].push(t1.id);
                        }
                    }
                }
                const conflictTasks = {};
                tasks.forEach(t => {
                    if (conflicts[t.id]) {
                        conflictTasks[t.id] = true;
                    }
                });
                conflicts[`__assignee__${assignee}`] = Object.keys(conflictTasks).length;
            });
            return conflicts;
        },

        autoBalance() {
            const byAssignee = {};
            state.tasks.forEach(t => {
                if (t.type === 'milestone') return;
                if (!t.assignee || !t.assignee.trim()) return;
                const a = t.assignee.trim();
                if (!byAssignee[a]) byAssignee[a] = [];
                byAssignee[a].push(t);
            });
            Object.keys(byAssignee).forEach(assignee => {
                let tasks = [...byAssignee[assignee]];
                tasks.sort((a, b) => a._startDay - b._startDay);
                for (let i = 1; i < tasks.length; i++) {
                    const prev = tasks[i - 1];
                    const curr = tasks[i];
                    if (curr._startDay < prev._endDay) {
                        curr._startDay = prev._endDay;
                        curr.earliestStartDate = utils.addDays(state.projectStart, prev._endDay);
                        curr._endDay = curr._startDay + curr.duration;
                    }
                }
            });
            scheduler.calculateSchedule();
        },

        getAssignees() {
            const set = new Set();
            state.tasks.forEach(t => {
                if (t.type === 'milestone') return;
                if (t.assignee && t.assignee.trim()) {
                    set.add(t.assignee.trim());
                }
            });
            return [...set];
        }
    };

    const layoutManager = {
        getVisibleRows() {
            if (state.isResourceView) {
                const assignees = resourceManager.getAssignees();
                const hasUnassigned = state.tasks.some(t => !t.assignee || !t.assignee.trim());
                const rows = [];
                assignees.forEach(a => {
                    rows.push({ type: 'resource', key: a, tasks: state.tasks.filter(t => t.assignee && t.assignee.trim() === a) });
                });
                if (hasUnassigned) {
                    rows.push({ type: 'resource', key: '未分配', tasks: state.tasks.filter(t => !t.assignee || !t.assignee.trim()) });
                }
                if (rows.length === 0) rows.push({ type: 'resource', key: '', tasks: [] });
                return rows;
            }
            const rows = [];
            state.groups.forEach(group => {
                const groupTasks = groupManager.getGroupTasks(group.id);
                rows.push({ type: 'group-summary', group: group, tasks: groupTasks });
                if (!group.collapsed) {
                    groupTasks.forEach(task => {
                        rows.push({ type: 'task', task: task, inGroup: true });
                    });
                }
            });
            const ungrouped = groupManager.getUngroupedTasks();
            ungrouped.forEach(task => {
                rows.push({ type: 'task', task: task, inGroup: false });
            });
            return rows;
        },

        getTaskRowIndex(taskId) {
            if (state.isResourceView) {
                const assignees = resourceManager.getAssignees();
                const task = state.tasks.find(t => t.id === taskId);
                const assignee = task.assignee && task.assignee.trim() ? task.assignee.trim() : '未分配';
                if (task.assignee && task.assignee.trim()) {
                    return assignees.indexOf(assignee);
                } else {
                    return assignees.length;
                }
            }
            const rows = this.getVisibleRows();
            for (let i = 0; i < rows.length; i++) {
                if (rows[i].type === 'task' && rows[i].task.id === taskId) {
                    return i;
                }
            }
            return -1;
        },

        getRowYOffset(rowIndex, rowType) {
            if (state.isResourceView) {
                return rowIndex * TASK_HEIGHT;
            }
            let y = 0;
            const rows = this.getVisibleRows();
            for (let i = 0; i < rowIndex && i < rows.length; i++) {
                if (rows[i].type === 'group-summary') {
                    y += GROUP_SUMMARY_HEIGHT;
                } else {
                    y += TASK_HEIGHT;
                }
            }
            return y;
        },

        getTotalHeight() {
            const rows = this.getVisibleRows();
            let h = 0;
            rows.forEach(r => {
                h += r.type === 'group-summary' ? GROUP_SUMMARY_HEIGHT : TASK_HEIGHT;
            });
            return h;
        }
    };

    const renderer = {
        getTimelineDays() {
            let maxDay = 0;
            state.tasks.forEach(t => {
                const effDuration = utils.getEffectiveDuration(t);
                const endDay = (t._startDay || 0) + effDuration;
                if (endDay > maxDay) maxDay = endDay;
            });
            return Math.max(60, maxDay + 30);
        },

        getTimelineWeeks() {
            const totalDays = this.getTimelineDays();
            const endDate = utils.addDays(state.projectStart, totalDays);
            const startWeek = utils.getWeekStart(state.projectStart);
            const endWeek = utils.getWeekEnd(endDate);
            return Math.ceil((endWeek - startWeek) / (7 * 24 * 60 * 60 * 1000)) + 1;
        },

        getUnitWidth() {
            return state.currentView === 'week' ? WEEK_WIDTH : DAY_WIDTH;
        },

        renderAll() {
            scheduler.calculateSchedule();
            if (state.currentView === 'list') {
                this.renderListView();
            } else {
                this.renderTimeline();
                this.renderTaskList();
                this.renderGantt();
                this.renderDependencies();
            }
            this.updateTaskCount();
            statsManager.updateStats();
        },

        switchView(view) {
            state.currentView = view;
            document.querySelectorAll('.view-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === view);
            });
            document.getElementById('timeline-header').style.display = (view === 'list') ? 'none' : '';
            document.getElementById('gantt-canvas').style.display = (view === 'list') ? 'none' : '';
            const canvasContainer = document.querySelector('.canvas-container');
            let listView = document.getElementById('list-view-container');
            if (!listView) {
                listView = document.createElement('div');
                listView.id = 'list-view-container';
                listView.className = 'list-view-container';
                canvasContainer.appendChild(listView);
            }
            listView.style.display = (view === 'list') ? '' : 'none';
            document.getElementById('btn-view-toggle').style.display = (view === 'list') ? 'none' : '';
            document.getElementById('btn-balance').style.display = (view === 'list') ? 'none' : '';
            document.getElementById('btn-undo-balance').style.display = (view === 'list') ? 'none' : '';
            this.renderAll();
        },

        renderTimeline() {
            if (state.currentView === 'week') {
                this.renderWeekTimeline();
            } else {
                this.renderDayTimeline();
            }
        },

        renderDayTimeline() {
            const container = document.getElementById('timeline-scale');
            const totalDays = this.getTimelineDays();
            const width = totalDays * DAY_WIDTH;
            container.style.width = width + 'px';
            container.innerHTML = '';

            let monthRow = document.createElement('div');
            monthRow.className = 'timeline-month-row';
            let dayRow = document.createElement('div');
            dayRow.className = 'timeline-day-row';

            let currentMonth = -1;
            let currentMonthStart = 0;

            for (let d = 0; d < totalDays; d++) {
                const date = utils.addDays(state.projectStart, d);
                const month = date.getMonth();

                if (month !== currentMonth) {
                    if (currentMonth >= 0) {
                        const label = document.createElement('div');
                        label.className = 'timeline-month-label';
                        const monthDate = utils.addDays(state.projectStart, currentMonthStart);
                        label.textContent = `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`;
                        label.style.left = (currentMonthStart * DAY_WIDTH) + 'px';
                        label.style.width = ((d - currentMonthStart) * DAY_WIDTH) + 'px';
                        monthRow.appendChild(label);
                    }
                    currentMonth = month;
                    currentMonthStart = d;
                }

                const dayLabel = document.createElement('div');
                dayLabel.className = 'timeline-day-label';
                const dayOfWeek = date.getDay();
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    dayLabel.classList.add('weekend');
                }
                dayLabel.textContent = date.getDate();
                dayLabel.style.left = (d * DAY_WIDTH + DAY_WIDTH / 2) + 'px';
                dayRow.appendChild(dayLabel);
            }

            const label = document.createElement('div');
            label.className = 'timeline-month-label';
            const monthDate = utils.addDays(state.projectStart, currentMonthStart);
            label.textContent = `${monthDate.getFullYear()}年${monthDate.getMonth() + 1}月`;
            label.style.left = (currentMonthStart * DAY_WIDTH) + 'px';
            label.style.width = ((totalDays - currentMonthStart) * DAY_WIDTH) + 'px';
            monthRow.appendChild(label);

            container.appendChild(monthRow);
            container.appendChild(dayRow);
        },

        renderWeekTimeline() {
            const container = document.getElementById('timeline-scale');
            const totalWeeks = this.getTimelineWeeks();
            const width = totalWeeks * WEEK_WIDTH;
            container.style.width = width + 'px';
            container.innerHTML = '';

            const weekRow = document.createElement('div');
            weekRow.className = 'timeline-week-row';
            const dayRow = document.createElement('div');
            dayRow.className = 'timeline-week-row';

            const startWeek = utils.getWeekStart(state.projectStart);

            for (let w = 0; w < totalWeeks; w++) {
                const weekDate = new Date(startWeek);
                weekDate.setDate(weekDate.getDate() + w * 7);
                const weekInfo = utils.getWeekLabel(weekDate);

                const weekLabel = document.createElement('div');
                weekLabel.className = 'timeline-week-label';
                weekLabel.textContent = `第${weekInfo.weekNum}周 ${weekInfo.startLabel}-${weekInfo.endLabel}`;
                weekLabel.style.left = (w * WEEK_WIDTH) + 'px';
                weekLabel.style.width = WEEK_WIDTH + 'px';
                weekRow.appendChild(weekLabel);

                const weekStartDay = utils.diffDays(state.projectStart, weekDate);
                for (let d = 0; d < 7; d++) {
                    const dayDate = utils.addDays(weekDate, d);
                    const dayLabel = document.createElement('div');
                    dayLabel.className = 'timeline-week-day-label';
                    const dayOfWeek = dayDate.getDay();
                    if (dayOfWeek === 0 || dayOfWeek === 6) {
                        dayLabel.classList.add('weekend');
                    }
                    dayLabel.textContent = dayDate.getDate();
                    dayLabel.style.left = (w * WEEK_WIDTH + (d + 0.5) * (WEEK_WIDTH / 7)) + 'px';
                    dayRow.appendChild(dayLabel);
                }
            }

            container.appendChild(weekRow);
            container.appendChild(dayRow);
        },

        renderTaskList() {
            const list = document.getElementById('task-list');
            const conflicts = resourceManager.findConflicts();

            if (state.tasks.length === 0 && state.groups.length === 0) {
                list.innerHTML = '<div style="padding:40px 16px;color:#909399;font-size:12px;text-align:center;">暂无任务，点击上方按钮新增</div>';
                return;
            }

            list.innerHTML = '';

            list.addEventListener('dragover', (e) => {
                if (e.dataTransfer && e.dataTransfer.types.includes('text/task-id')) {
                    e.preventDefault();
                    e.stopPropagation();
                    list.classList.add('drop-target-ungrouped');
                }
            });
            list.addEventListener('dragleave', (e) => {
                if (e.target === list) {
                    list.classList.remove('drop-target-ungrouped');
                }
            });
            list.addEventListener('drop', (e) => {
                list.classList.remove('drop-target-ungrouped');
                const taskId = e.dataTransfer.getData('text/task-id');
                if (taskId) {
                    e.preventDefault();
                    e.stopPropagation();
                    groupManager.moveTaskToGroup(taskId, null);
                    utils.showToast('已移出分组', 'success');
                }
            });

            state.groups.forEach(group => {
                this.renderGroupItem(list, group, conflicts);
            });

            const ungroupedTasks = groupManager.getUngroupedTasks();
            if (ungroupedTasks.length > 0 || state.groups.length > 0) {
                if (state.groups.length > 0) {
                    const label = document.createElement('div');
                    label.className = 'ungrouped-label';
                    label.textContent = '未分组（可拖入此处移出分组）';

                    label.addEventListener('dragover', (e) => {
                        if (e.dataTransfer && e.dataTransfer.types.includes('text/task-id')) {
                            e.preventDefault();
                            e.stopPropagation();
                            label.classList.add('drag-over');
                        }
                    });
                    label.addEventListener('dragleave', () => {
                        label.classList.remove('drag-over');
                    });
                    label.addEventListener('drop', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        label.classList.remove('drag-over');
                        const taskId = e.dataTransfer.getData('text/task-id');
                        if (taskId) {
                            groupManager.moveTaskToGroup(taskId, null);
                            utils.showToast('已移出分组', 'success');
                        }
                    });

                    list.appendChild(label);
                }
                ungroupedTasks.forEach(task => {
                    this.renderTaskItem(list, task, conflicts, null);
                });
            }
        },

        renderGroupItem(container, group, conflicts) {
            const groupEl = document.createElement('div');
            groupEl.className = 'group-item';
            groupEl.dataset.groupId = group.id;

            const header = document.createElement('div');
            header.className = 'group-header';

            const toggle = document.createElement('div');
            toggle.className = 'group-toggle' + (group.collapsed ? '' : ' expanded');
            toggle.innerHTML = '▶';
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                groupManager.toggleGroup(group.id);
            });
            header.appendChild(toggle);

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'group-name-input';
            nameInput.value = group.name;
            nameInput.addEventListener('input', (e) => {
                groupManager.renameGroup(group.id, e.target.value);
            });
            nameInput.addEventListener('click', (e) => e.stopPropagation());
            header.appendChild(nameInput);

            const range = groupManager.getGroupTimeRange(group.id);
            const timeRangeEl = document.createElement('span');
            timeRangeEl.className = 'group-time-range';
            if (range) {
                const startDate = utils.formatDate(utils.addDays(state.projectStart, range.start));
                const endDate = utils.formatDate(utils.addDays(state.projectStart, range.end));
                timeRangeEl.textContent = `${startDate} ~ ${endDate}`;
            } else {
                timeRangeEl.textContent = '空';
            }
            header.appendChild(timeRangeEl);

            const delBtn = document.createElement('span');
            delBtn.className = 'group-delete';
            delBtn.title = '删除分组';
            delBtn.innerHTML = '×';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                groupManager.deleteGroup(group.id);
            });
            header.appendChild(delBtn);

            header.addEventListener('click', () => {
                groupManager.toggleGroup(group.id);
            });

            groupEl.appendChild(header);

            const tasksContainer = document.createElement('div');
            tasksContainer.className = 'group-tasks' + (group.collapsed ? ' collapsed' : '');

            const groupTasks = groupManager.getGroupTasks(group.id);
            groupTasks.forEach(task => {
                this.renderTaskItem(tasksContainer, task, conflicts, group.id);
            });

            groupEl.appendChild(tasksContainer);

            groupEl.addEventListener('dragover', (e) => {
                if (e.dataTransfer && e.dataTransfer.types.includes('text/task-id')) {
                    e.preventDefault();
                    e.stopPropagation();
                    groupEl.classList.add('drag-over');
                }
            });
            groupEl.addEventListener('dragleave', () => {
                groupEl.classList.remove('drag-over');
            });
            groupEl.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                groupEl.classList.remove('drag-over');
                const taskId = e.dataTransfer.getData('text/task-id');
                if (taskId) {
                    groupManager.moveTaskToGroup(taskId, group.id);
                    utils.showToast('已移入分组', 'success');
                }
            });

            container.appendChild(groupEl);
        },

        renderTaskItem(container, task, conflicts, groupId) {
            const item = document.createElement('div');
            item.className = 'task-item';
            if (task.type === 'milestone') item.classList.add('milestone');
            if (task.id === state.selectedTaskId) item.classList.add('selected');
            item.dataset.id = task.id;
            item.dataset.groupId = groupId || '';
            item.draggable = true;

            const assignee = task.assignee && task.assignee.trim() ? task.assignee.trim() : '';
            const assigneeCount = assignee ? (conflicts[`__assignee__${assignee}`] || 0) : 0;

            const typeBadge = task.type === 'milestone'
                ? '<span class="task-type-badge milestone">里程碑</span>'
                : '';

            const deviation = state.selectedBaselineId ? baselineManager.getTaskDeviation(task.id) : null;
            let deviationBadge = '';
            if (deviation !== null && deviation !== 0) {
                const devClass = deviation > 0 ? 'delayed' : 'advanced';
                const devText = deviation > 0 ? `+${deviation}天` : `${deviation}天`;
                deviationBadge = `<span class="task-deviation ${devClass}">${devText}</span>`;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayDay = utils.diffDays(state.projectStart, today);
            const isLagging = task.type !== 'milestone' && todayDay > task._startDay && (task.progress || 0) < 100;
            const laggingBadge = isLagging ? '<span class="task-lagging">滞后</span>' : '';

            const durationField = task.type === 'milestone'
                ? `<div class="task-item-field"><label>日期</label><div style="flex:1;font-size:12px;color:#b88230;font-weight:500;">${utils.formatDate(utils.addDays(state.projectStart, task._startDay))}</div></div>`
                : `<div class="task-item-field">
                        <label>工期(天)</label>
                        <input type="number" class="task-duration" min="1" max="60" value="${task.duration}" />
                    </div>`;

            const earliestField = task.type === 'milestone'
                ? ''
                : `<div class="task-item-field">
                        <label>最早开始</label>
                        <input type="date" class="task-earliest" value="${task.earliestStartDate ? utils.formatDate(new Date(task.earliestStartDate)) : ''}" />
                    </div>`;

            const progressField = task.type === 'milestone'
                ? `<div class="task-item-field">
                        <label>状态</label>
                        <select class="task-progress-select" style="flex:1;padding:4px 8px;border:1px solid #dcdfe6;border-radius:3px;font-size:12px;color:#606266;background:#fff;outline:none;">
                            <option value="0" ${task.progress === 0 ? 'selected' : ''}>未达成</option>
                            <option value="100" ${task.progress === 100 ? 'selected' : ''}>已达成</option>
                        </select>
                    </div>`
                : `<div class="task-progress-wrapper">
                        <div class="task-progress-label">
                            <span>完成度</span>
                            <input type="number" class="task-progress-input" min="0" max="100" value="${task.progress || 0}" />
                        </div>
                        <input type="range" class="task-progress-slider" min="0" max="100" value="${task.progress || 0}" />
                    </div>`;

            item.innerHTML = `
                <div class="task-item-header">
                    <div style="flex:1;display:flex;align-items:center;min-width:0;">
                        ${typeBadge}
                        <input type="text" class="task-item-name" value="${this.escapeHtml(task.name)}" />
                    </div>
                    ${deviationBadge}
                    ${laggingBadge}
                    <span class="task-item-delete" title="删除">×</span>
                </div>
                ${durationField}
                ${progressField}
                <div class="task-item-field">
                    <label>负责人</label>
                    <div class="assignee-wrapper">
                        <input type="text" class="assignee-input" value="${this.escapeHtml(task.assignee)}" ${task.type === 'milestone' ? 'disabled style="background:#f5f7fa;"' : ''} />
                        ${assigneeCount > 0 ? `<span class="conflict-badge">${assigneeCount}</span>` : ''}
                    </div>
                </div>
                ${earliestField}
            `;
            container.appendChild(item);

            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/task-id', task.id);
                item.classList.add('dragging');
                e.stopPropagation();
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
            });

            item.addEventListener('dragover', (e) => {
                if (e.dataTransfer && e.dataTransfer.types.includes('text/task-id')) {
                    const srcId = e.dataTransfer.getData('text/task-id');
                    if (srcId && srcId !== task.id) {
                        e.preventDefault();
                        e.stopPropagation();
                        item.classList.add('drop-target');
                    }
                }
            });
            item.addEventListener('dragleave', () => {
                item.classList.remove('drop-target');
            });
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                item.classList.remove('drop-target');
                const taskId = e.dataTransfer.getData('text/task-id');
                if (taskId && taskId !== task.id) {
                    groupManager.moveTaskToGroup(taskId, task.groupId || null);
                    utils.showToast('已变更分组', 'success');
                }
            });

            const nameInput = item.querySelector('.task-item-name');
            const durInput = item.querySelector('.task-duration');
            const assigneeInput = item.querySelector('.assignee-input');
            const earliestInput = item.querySelector('.task-earliest');
            const delBtn = item.querySelector('.task-item-delete');
            const progressSlider = item.querySelector('.task-progress-slider');
            const progressInput = item.querySelector('.task-progress-input');
            const progressSelect = item.querySelector('.task-progress-select');

            nameInput.addEventListener('focus', () => {
                state.selectedTaskId = task.id;
                state.selectedDepId = null;
                this.renderTaskList();
                this.renderGantt();
                this.renderDependencies();
            });

            nameInput.addEventListener('input', (e) => {
                task.name = e.target.value || '未命名任务';
                this.renderGantt();
                this.renderDependencies();
            });

            if (durInput) {
                durInput.addEventListener('change', (e) => {
                    let val = parseInt(e.target.value);
                    if (isNaN(val)) val = 1;
                    val = utils.clamp(val, 1, 60);
                    e.target.value = val;
                    task.duration = val;
                    this.renderAll();
                });
            }

            assigneeInput.addEventListener('input', (e) => {
                task.assignee = e.target.value;
                this.renderAll();
            });

            if (earliestInput) {
                earliestInput.addEventListener('change', (e) => {
                    task.earliestStartDate = e.target.value ? new Date(e.target.value) : null;
                    this.renderAll();
                });
            }

            if (progressSlider) {
                progressSlider.addEventListener('input', (e) => {
                    taskManager.setTaskProgress(task.id, e.target.value);
                });
            }

            if (progressInput) {
                progressInput.addEventListener('change', (e) => {
                    taskManager.setTaskProgress(task.id, e.target.value);
                });
            }

            if (progressSelect) {
                progressSelect.addEventListener('change', (e) => {
                    taskManager.setTaskProgress(task.id, e.target.value);
                });
            }

            delBtn.addEventListener('click', () => {
                taskManager.deleteTask(task.id);
            });
        },

        renderGantt() {
            const rowsContainer = document.getElementById('gantt-rows');
            const totalDays = this.getTimelineDays();
            let width;
            if (state.currentView === 'week') {
                width = this.getTimelineWeeks() * WEEK_WIDTH;
            } else {
                width = totalDays * DAY_WIDTH;
            }
            rowsContainer.innerHTML = '';
            rowsContainer.style.height = layoutManager.getTotalHeight() + 'px';

            const conflicts = resourceManager.findConflicts();
            const rows = layoutManager.getVisibleRows();

            rows.forEach(row => {
                if (row.type === 'resource') {
                    this.renderResourceRow(rowsContainer, row, width, totalDays, conflicts);
                } else if (row.type === 'group-summary') {
                    this.renderGroupSummaryRow(rowsContainer, row, width, totalDays);
                } else if (row.type === 'task') {
                    this.renderTaskRow(rowsContainer, row, width, totalDays, conflicts);
                }
            });

            this.renderTodayLine(rowsContainer, totalDays);
        },

        dayToPosition(day) {
            if (state.currentView === 'week') {
                const date = utils.addDays(state.projectStart, day);
                const startWeek = utils.getWeekStart(state.projectStart);
                const weekStart = utils.getWeekStart(date);
                const weekIdx = Math.round((weekStart - startWeek) / (7 * 24 * 60 * 60 * 1000));
                const dayInWeek = (date.getDay() + 6) % 7;
                return weekIdx * WEEK_WIDTH + dayInWeek * (WEEK_WIDTH / 7);
            } else {
                return day * DAY_WIDTH;
            }
        },

        daysToWidth(days) {
            if (state.currentView === 'week') {
                return days * (WEEK_WIDTH / 7);
            } else {
                return days * DAY_WIDTH;
            }
        },

        renderTodayLine(container, totalDays) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayDay = utils.diffDays(state.projectStart, today);

            if (todayDay < 0 || todayDay >= totalDays) return;

            const todayLine = document.createElement('div');
            todayLine.className = 'today-line';
            const unitOffset = state.currentView === 'week' ? WEEK_WIDTH / 14 : DAY_WIDTH / 2;
            todayLine.style.left = (this.dayToPosition(todayDay) + unitOffset) + 'px';

            const label = document.createElement('div');
            label.className = 'today-line-label';
            label.textContent = '今天';
            todayLine.appendChild(label);

            container.appendChild(todayLine);
        },

        renderResourceRow(container, row, width, totalDays, conflicts) {
            const el = document.createElement('div');
            el.className = 'gantt-row resource-row';

            const label = document.createElement('div');
            label.className = 'gantt-row-label';
            const displayName = row.key || '未分配';
            const assignee = row.key;
            const count = assignee && assignee !== '未分配' ?
                (conflicts[`__assignee__${assignee}`] || 0) : 0;
            label.textContent = displayName;
            if (count > 0) {
                label.innerHTML = `${displayName} <span class="conflict-badge">${count}</span>`;
            }
            el.appendChild(label);

            const grid = document.createElement('div');
            grid.className = 'gantt-row-grid';
            grid.style.width = width + 'px';
            this.renderGridColumns(grid, totalDays);
            row.tasks.forEach(task => {
                if (task.type === 'milestone') {
                    this.renderMilestone(grid, task);
                } else {
                    this.renderTaskBar(grid, task, conflicts);
                }
            });
            el.appendChild(grid);
            container.appendChild(el);
        },

        renderGroupSummaryRow(container, row, width, totalDays) {
            const group = row.group;
            const el = document.createElement('div');
            el.className = 'gantt-row group-summary-row';
            el.dataset.groupId = group.id;

            const label = document.createElement('div');
            label.className = 'gantt-row-label';
            const toggleChar = group.collapsed ? '▶' : '▼';
            label.innerHTML = `<span style="display:inline-block;width:16px;">${toggleChar}</span>${this.escapeHtml(group.name)}`;
            label.style.cursor = 'pointer';
            label.addEventListener('click', () => {
                groupManager.toggleGroup(group.id);
            });
            el.appendChild(label);

            const grid = document.createElement('div');
            grid.className = 'gantt-row-grid';
            grid.style.width = width + 'px';
            this.renderGridColumns(grid, totalDays);

            const range = groupManager.getGroupTimeRange(group.id);
            if (range && range.end >= range.start) {
                const summary = document.createElement('div');
                summary.className = 'group-summary-bar';
                summary.style.left = this.dayToPosition(range.start) + 'px';
                const minBarWidth = state.currentView === 'week' ? WEEK_WIDTH / 7 : DAY_WIDTH;
                const barWidth = Math.max(minBarWidth, this.daysToWidth(range.end - range.start));
                summary.style.width = barWidth + 'px';

                const taskCount = row.tasks.length;
                const startDate = utils.formatDate(utils.addDays(state.projectStart, range.start));
                const endDate = utils.formatDate(utils.addDays(state.projectStart, range.end));
                const summaryLabel = document.createElement('span');
                summaryLabel.className = 'group-summary-bar-label';
                if (range.end === range.start) {
                    summaryLabel.textContent = `${taskCount}项  ${startDate}`;
                } else {
                    summaryLabel.textContent = `${taskCount}项  ${startDate} ~ ${endDate}`;
                }
                summary.appendChild(summaryLabel);
                grid.appendChild(summary);
            }

            el.appendChild(grid);
            container.appendChild(el);
        },

        renderTaskRow(container, row, width, totalDays, conflicts) {
            const task = row.task;
            const el = document.createElement('div');
            el.className = 'gantt-row';
            if (row.inGroup) el.classList.add('group-task-row');

            const label = document.createElement('div');
            label.className = 'gantt-row-label';
            const prefix = task.type === 'milestone' ? '◆ ' : '';
            label.textContent = prefix + (task.name || '未命名任务');
            if (task.type === 'milestone') {
                label.style.color = '#b88230';
                label.style.fontWeight = '600';
            }
            el.appendChild(label);

            const grid = document.createElement('div');
            grid.className = 'gantt-row-grid';
            grid.style.width = width + 'px';
            grid.dataset.taskId = task.id;
            this.renderGridColumns(grid, totalDays);

            if (task.type === 'milestone') {
                this.renderMilestone(grid, task);
            } else {
                this.renderTaskBar(grid, task, conflicts);
            }

            el.appendChild(grid);
            container.appendChild(el);
        },

        renderGridColumns(grid, totalDays) {
            if (state.currentView === 'week') {
                const totalWeeks = this.getTimelineWeeks();
                const startWeek = utils.getWeekStart(state.projectStart);
                for (let w = 0; w < totalWeeks; w++) {
                    const col = document.createElement('div');
                    col.className = 'grid-column';
                    const weekDate = new Date(startWeek);
                    weekDate.setDate(weekDate.getDate() + w * 7);
                    const weekEnd = utils.getWeekEnd(weekDate);
                    if (weekDate.getDay() === 0 || weekDate.getDay() === 6) {
                    }
                    col.style.left = (w * WEEK_WIDTH) + 'px';
                    col.style.width = WEEK_WIDTH + 'px';
                    grid.appendChild(col);
                }
            } else {
                for (let d = 0; d < totalDays; d++) {
                    const col = document.createElement('div');
                    col.className = 'grid-column';
                    const date = utils.addDays(state.projectStart, d);
                    const dow = date.getDay();
                    if (dow === 0 || dow === 6) {
                        col.classList.add('weekend');
                    }
                    col.style.left = (d * DAY_WIDTH) + 'px';
                    col.style.width = DAY_WIDTH + 'px';
                    grid.appendChild(col);
                }
            }
        },

        renderTaskBar(grid, task, conflicts) {
            if (state.selectedBaselineId) {
                const baselineTask = baselineManager.getBaselineTask(state.selectedBaselineId, task.id);
                if (baselineTask) {
                    const baselineBar = document.createElement('div');
                    baselineBar.className = 'baseline-bar';
                    const baselineDuration = baselineTask.duration || 0;
                    baselineBar.style.left = this.dayToPosition(baselineTask.startDay) + 'px';
                    const minWidth = state.currentView === 'week' ? WEEK_WIDTH / 7 : DAY_WIDTH;
                    baselineBar.style.width = Math.max(minWidth, this.daysToWidth(baselineDuration)) + 'px';
                    grid.appendChild(baselineBar);
                }
            }

            const bar = document.createElement('div');
            bar.className = 'task-bar';
            bar.dataset.id = task.id;

            if (task._isCritical) bar.classList.add('critical');
            if (task.id === state.selectedTaskId) bar.classList.add('selected');

            bar.style.left = this.dayToPosition(task._startDay) + 'px';
            bar.style.width = this.daysToWidth(task.duration) + 'px';

            const progressFill = document.createElement('div');
            progressFill.className = 'task-bar-progress';
            const progress = task.progress || 0;
            progressFill.style.width = progress + '%';
            bar.appendChild(progressFill);

            const label = document.createElement('span');
            label.className = 'task-bar-label';
            label.textContent = `${task.name} (${task.duration}天)`;
            bar.appendChild(label);

            const handleEnd = document.createElement('div');
            handleEnd.className = 'task-bar-handle-end dependency-source';
            handleEnd.title = '拖拽到其他任务创建依赖';
            bar.appendChild(handleEnd);

            if (conflicts[task.id] && conflicts[task.id].length > 0) {
                const warning = document.createElement('div');
                warning.className = 'task-warning-bar';
                warning.style.width = this.daysToWidth(task.duration) + 'px';
                bar.appendChild(warning);
            }

            if (state.selectedBaselineId) {
                const deviation = baselineManager.getTaskDeviation(task.id);
                if (deviation !== null && deviation !== 0) {
                    const triangle = document.createElement('div');
                    triangle.className = 'deviation-triangle';
                    if (deviation > 0) {
                        triangle.classList.add('delayed');
                    } else {
                        triangle.classList.add('advanced');
                    }
                    triangle.style.left = (this.dayToPosition(task._startDay) - 10) + 'px';
                    grid.appendChild(triangle);
                }
            }

            this.attachTaskBarEvents(bar, task, handleEnd);
            grid.appendChild(bar);
        },

        renderMilestone(grid, task) {
            if (state.selectedBaselineId) {
                const baselineTask = baselineManager.getBaselineTask(state.selectedBaselineId, task.id);
                if (baselineTask) {
                    const baselineMarker = document.createElement('div');
                    baselineMarker.className = 'baseline-marker';
                    baselineMarker.style.left = (this.dayToPosition(baselineTask.startDay) + 3) + 'px';
                    grid.appendChild(baselineMarker);
                }
            }

            const marker = document.createElement('div');
            marker.className = 'milestone-marker';
            marker.dataset.id = task.id;

            if (task._isCritical) marker.classList.add('critical');
            if (task.id === state.selectedTaskId) marker.classList.add('selected');
            if (task.progress === 100) marker.classList.add('completed');

            marker.style.left = this.dayToPosition(task._startDay) + 'px';

            const depHandle = document.createElement('div');
            depHandle.className = 'milestone-dep-handle';
            depHandle.title = '拖拽创建依赖';
            marker.appendChild(depHandle);

            const label = document.createElement('div');
            label.className = 'milestone-marker-label';
            label.textContent = `${task.name}`;
            label.style.left = (26) + 'px';
            label.style.top = '50%';

            if (state.selectedBaselineId) {
                const deviation = baselineManager.getTaskDeviation(task.id);
                if (deviation !== null && deviation !== 0) {
                    const triangle = document.createElement('div');
                    triangle.className = 'deviation-triangle';
                    if (deviation > 0) {
                        triangle.classList.add('delayed');
                    } else {
                        triangle.classList.add('advanced');
                    }
                    triangle.style.left = (this.dayToPosition(task._startDay) - 10) + 'px';
                    grid.appendChild(triangle);
                }
            }

            this.attachMilestoneEvents(marker, task, depHandle);
            grid.appendChild(marker);
            grid.appendChild(label);
        },

        attachTaskBarEvents(bar, task, handleEnd) {
            let startX = 0;
            let originalStartDay = 0;
            let isDragging = false;

            bar.addEventListener('mousedown', (e) => {
                if (e.target === handleEnd) return;
                e.stopPropagation();
                state.selectedTaskId = task.id;
                state.selectedDepId = null;
                this.renderTaskList();
                this.renderGantt();
                this.renderDependencies();

                e.preventDefault();
                isDragging = true;
                startX = e.clientX;
                originalStartDay = task._startDay;
                bar.classList.add('dragging');

                state.dragState = {
                    taskId: task.id,
                    startX: startX,
                    originalStartDay: originalStartDay,
                    currentStartDay: originalStartDay,
                    isValid: true
                };

                const onMove = (ev) => {
                    if (!isDragging) return;
                    const dx = ev.clientX - startX;
                    let dayDelta;
                    if (state.currentView === 'week') {
                        dayDelta = Math.round(dx / WEEK_WIDTH) * 7;
                    } else {
                        dayDelta = Math.round(dx / DAY_WIDTH);
                    }
                    let newStart = originalStartDay + dayDelta;
                    if (state.currentView === 'week') {
                        newStart = utils.snapToWeek(newStart);
                    }
                    newStart = Math.max(0, newStart);
                    const minValid = this.getMinValidStart(task.id);
                    const isValid = newStart >= minValid;

                    state.dragState.currentStartDay = newStart;
                    state.dragState.isValid = isValid;

                    bar.style.left = this.dayToPosition(newStart) + 'px';
                    if (isValid) {
                        bar.classList.remove('invalid');
                    } else {
                        bar.classList.add('invalid');
                    }
                };

                const onUp = () => {
                    if (!isDragging) return;
                    isDragging = false;
                    bar.classList.remove('dragging');
                    bar.classList.remove('invalid');

                    let finalStart;
                    if (state.dragState.isValid) {
                        finalStart = state.dragState.currentStartDay;
                    } else {
                        finalStart = this.getMinValidStart(task.id);
                    }
                    if (state.currentView === 'week') {
                        finalStart = utils.snapToWeek(finalStart);
                    }

                    if (finalStart !== originalStartDay) {
                        task._startDay = finalStart;
                        task.earliestStartDate = utils.addDays(state.projectStart, finalStart);
                        scheduler.calculateSchedule();
                    }

                    state.dragState = null;
                    this.renderAll();

                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            handleEnd.addEventListener('mousedown', (e) => {
                this.startDependencyDrag(task, e);
            });
        },

        attachMilestoneEvents(marker, task, depHandle) {
            marker.addEventListener('mousedown', (e) => {
                if (e.target === depHandle) return;
                e.stopPropagation();
                state.selectedTaskId = task.id;
                state.selectedDepId = null;
                this.renderTaskList();
                this.renderGantt();
                this.renderDependencies();
            });

            depHandle.addEventListener('mousedown', (e) => {
                this.startDependencyDrag(task, e);
            });
        },

        startDependencyDrag(task, e) {
            e.preventDefault();
            e.stopPropagation();

            state.depDragState = {
                fromId: task.id,
                toId: null
            };

            const svg = document.getElementById('dependency-svg');
            const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            preview.setAttribute('class', 'dep-line-preview');
            preview.setAttribute('id', 'dep-preview');
            svg.appendChild(preview);

            const effDuration = utils.getEffectiveDuration(task);

            const onMove = (ev) => {
                if (!state.depDragState) return;

                const canvas = document.getElementById('gantt-canvas');
                const rect = canvas.getBoundingClientRect();

                const fromRowIdx = layoutManager.getTaskRowIndex(task.id);
                const fromX1 = this.dayToPosition(task._startDay + effDuration);
                let fromY;
                if (state.isResourceView) {
                    fromY = fromRowIdx * TASK_HEIGHT + TASK_HEIGHT / 2;
                } else {
                    fromY = layoutManager.getRowYOffset(fromRowIdx) + TASK_HEIGHT / 2;
                }

                const toX = ev.clientX - rect.left + canvas.scrollLeft;
                const toY = ev.clientY - rect.top + canvas.scrollTop;

                const midX = (fromX1 + toX) / 2;
                const d = `M ${fromX1} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
                preview.setAttribute('d', d);

                const target = document.elementFromPoint(ev.clientX, ev.clientY);
                const taskBar = target ? target.closest('.task-bar') : null;
                const milestone = target ? target.closest('.milestone-marker') : null;
                const el = taskBar || milestone;
                state.depDragState.toId = el ? el.dataset.id : null;
            };

            const onUp = () => {
                preview.remove();

                if (state.depDragState && state.depDragState.toId &&
                    state.depDragState.toId !== state.depDragState.fromId) {
                    const cycle = scheduler.detectCycleWithNewDep(
                        state.depDragState.fromId,
                        state.depDragState.toId
                    );

                    if (cycle) {
                        utils.flashScreen();
                        const cycleNames = cycle.map(id => {
                            const t = state.tasks.find(x => x.id === id);
                            return t ? t.name : id;
                        }).join(' → ');
                        utils.showToast('检测到循环依赖: ' + cycleNames, 'error');
                    } else {
                        taskManager.addDependency(state.depDragState.fromId, state.depDragState.toId);
                    }
                }

                state.depDragState = null;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        },

        getMinValidStart(taskId) {
            const preds = state.dependencies.filter(d => d.to === taskId);
            let minDay = 0;
            preds.forEach(dep => {
                const pred = state.tasks.find(t => t.id === dep.from);
                if (pred) {
                    const predDuration = utils.getEffectiveDuration(pred);
                    const end = pred._startDay + predDuration;
                    if (end > minDay) minDay = end;
                }
            });
            return minDay;
        },

        renderDependencies() {
            const svg = document.getElementById('dependency-svg');
            const totalDays = this.getTimelineDays();
            const totalHeight = Math.max(100, layoutManager.getTotalHeight());
            let svgWidth;
            if (state.currentView === 'week') {
                svgWidth = this.getTimelineWeeks() * WEEK_WIDTH;
            } else {
                svgWidth = totalDays * DAY_WIDTH;
            }

            svg.setAttribute('width', svgWidth);
            svg.setAttribute('height', totalHeight + 100);
            svg.innerHTML = `
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7"
                        refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="#909399" />
                    </marker>
                </defs>
            `;

            state.dependencies.forEach(dep => {
                const fromTask = state.tasks.find(t => t.id === dep.from);
                const toTask = state.tasks.find(t => t.id === dep.to);
                if (!fromTask || !toTask) return;

                const fromRowIdx = layoutManager.getTaskRowIndex(dep.from);
                const toRowIdx = layoutManager.getTaskRowIndex(dep.to);
                if (fromRowIdx < 0 || toRowIdx < 0) return;

                const fromDuration = utils.getEffectiveDuration(fromTask);
                let fromY, toY;
                if (state.isResourceView) {
                    fromY = fromRowIdx * TASK_HEIGHT + TASK_HEIGHT / 2;
                    toY = toRowIdx * TASK_HEIGHT + TASK_HEIGHT / 2;
                } else {
                    fromY = layoutManager.getRowYOffset(fromRowIdx) + TASK_HEIGHT / 2;
                    toY = layoutManager.getRowYOffset(toRowIdx) + TASK_HEIGHT / 2;
                }

                const fromX = this.dayToPosition(fromTask._startDay + fromDuration);
                const toX = this.dayToPosition(toTask._startDay);

                const midX = (fromX + toX) / 2;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const d = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX - 8} ${toY}`;
                path.setAttribute('d', d);
                path.setAttribute('class', 'dep-line');
                path.setAttribute('marker-end', 'url(#arrowhead)');
                path.dataset.depId = dep.id;

                if (dep.id === state.selectedDepId) {
                    path.classList.add('selected');
                }

                path.addEventListener('click', (e) => {
                    e.stopPropagation();
                    state.selectedDepId = dep.id;
                    state.selectedTaskId = null;
                    this.renderAll();
                });

                svg.appendChild(path);
            });

            svg.addEventListener('click', () => {
                if (state.selectedDepId) {
                    if (confirm('删除此依赖关系？')) {
                        taskManager.deleteDependency(state.selectedDepId);
                    }
                }
            });
        },

        updateTaskCount() {
            const milestoneCount = state.tasks.filter(t => t.type === 'milestone').length;
            const taskCount = state.tasks.length - milestoneCount;
            document.getElementById('task-count').textContent =
                `${taskCount}任务 / ${milestoneCount}里程碑 / ${MAX_TASKS} 总数`;
        },

        escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        },

        renderListView() {
            const container = document.getElementById('list-view-container');
            if (!container) return;

            const sortField = state.listSortField;
            const sortDir = state.listSortDirection;

            let sortedTasks = [...state.tasks];
            if (sortField) {
                sortedTasks.sort((a, b) => {
                    let va, vb;
                    switch (sortField) {
                        case 'name':
                            va = a.name || '';
                            vb = b.name || '';
                            return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
                        case 'duration':
                            va = a.duration || 0;
                            vb = b.duration || 0;
                            return sortDir === 'asc' ? va - vb : vb - va;
                        case 'startDate':
                            va = a._startDay || 0;
                            vb = b._startDay || 0;
                            return sortDir === 'asc' ? va - vb : vb - va;
                        case 'progress':
                            va = a.progress || 0;
                            vb = b.progress || 0;
                            return sortDir === 'asc' ? va - vb : vb - va;
                        default:
                            return 0;
                    }
                });
            }

            const columns = [
                { key: 'name', label: '任务名称' },
                { key: 'duration', label: '工期(天)' },
                { key: 'assignee', label: '负责人' },
                { key: 'startDate', label: '开始日期' },
                { key: 'endDate', label: '结束日期' },
                { key: 'progress', label: '完成度' },
                { key: 'predecessors', label: '前置任务' },
                { key: 'status', label: '状态' }
            ];

            let html = '<table class="list-view-table"><thead><tr>';
            columns.forEach(col => {
                let sortClass = '';
                if (sortField === col.key) {
                    sortClass = sortDir === 'asc' ? 'sort-asc' : 'sort-desc';
                }
                html += `<th data-field="${col.key}" class="${sortClass}">${col.label}</th>`;
            });
            html += '</tr></thead><tbody>';

            const renderedTaskIds = new Set();

            state.groups.forEach(group => {
                const toggleChar = group.collapsed ? '▶' : '▼';
                const toggleClass = group.collapsed ? '' : 'expanded';
                html += `<tr class="group-row" data-group-id="${group.id}">
                    <td colspan="8">
                        <span class="group-toggle ${toggleClass}">${toggleChar}</span>
                        ${this.escapeHtml(group.name)}
                    </td>
                </tr>`;
                if (!group.collapsed) {
                    const groupTasks = sortedTasks.filter(t => t.groupId === group.id);
                    groupTasks.forEach(task => {
                        renderedTaskIds.add(task.id);
                        html += this.renderListTaskRow(task, true);
                    });
                }
            });

            const ungroupedTasks = sortedTasks.filter(t => !t.groupId && !renderedTaskIds.has(t.id));
            if (state.groups.length > 0 && ungroupedTasks.length > 0) {
                html += `<tr class="group-row"><td colspan="8" style="color:#909399;font-weight:500;">未分组</td></tr>`;
            }
            ungroupedTasks.forEach(task => {
                html += this.renderListTaskRow(task, false);
            });

            html += '</tbody></table>';
            container.innerHTML = html;

            container.querySelectorAll('th[data-field]').forEach(th => {
                th.addEventListener('click', () => {
                    const field = th.dataset.field;
                    if (state.listSortField === field) {
                        state.listSortDirection = state.listSortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        state.listSortField = field;
                        state.listSortDirection = 'asc';
                    }
                    this.renderListView();
                });
            });

            container.querySelectorAll('.group-row').forEach(row => {
                const groupId = row.dataset.groupId;
                if (groupId) {
                    row.addEventListener('click', () => {
                        groupManager.toggleGroup(groupId);
                    });
                }
            });

            this.attachListEditEvents(container);
        },

        renderListTaskRow(task, inGroup) {
            const startDate = utils.formatDate(utils.addDays(state.projectStart, task._startDay));
            const effDuration = utils.getEffectiveDuration(task);
            const endDate = utils.formatDate(utils.addDays(state.projectStart, task._startDay + effDuration));
            const status = utils.getTaskStatus(task);
            const statusText = status === 'completed' ? '已完成' : (status === 'lagging' ? '滞后' : '进行中');
            const predecessors = utils.getPredecessorNames(task.id);
            const progress = task.progress || 0;

            const rowClass = inGroup ? 'task-row in-group' : 'task-row';
            const durationDisplay = task.type === 'milestone' ? '里程碑' : task.duration;
            const durationInput = task.type === 'milestone'
                ? `<span style="color:#b88230;font-weight:500;">里程碑</span>`
                : `<input type="number" class="list-edit list-edit-duration" min="1" max="60" value="${task.duration}" data-id="${task.id}" />`;

            return `<tr class="${rowClass}" data-task-id="${task.id}">
                <td><input type="text" class="list-edit list-edit-name" value="${this.escapeHtml(task.name)}" data-id="${task.id}" /></td>
                <td>${durationInput}</td>
                <td><input type="text" class="list-edit list-edit-assignee" value="${this.escapeHtml(task.assignee || '')}" data-id="${task.id}" ${task.type === 'milestone' ? 'disabled style="background:#f5f7fa;"' : ''} /></td>
                <td>${startDate}</td>
                <td>${endDate}</td>
                <td>
                    <div class="progress-cell">
                        <div class="progress-bar"><div class="progress-fill" style="width:${progress}%"></div></div>
                        <input type="number" class="list-edit list-edit-progress" min="0" max="100" value="${progress}" data-id="${task.id}" style="width:50px;min-width:50px;padding:2px 4px;font-size:11px;" />
                    </div>
                </td>
                <td style="color:#606266;font-size:11px;">${this.escapeHtml(predecessors) || '-'}</td>
                <td><span class="status-badge status-${status}">${statusText}</span></td>
            </tr>`;
        },

        attachListEditEvents(container) {
            container.querySelectorAll('.list-edit-name').forEach(input => {
                input.addEventListener('change', (e) => {
                    const task = state.tasks.find(t => t.id === e.target.dataset.id);
                    if (task) {
                        task.name = e.target.value || '未命名任务';
                        this.renderListView();
                    }
                });
            });

            container.querySelectorAll('.list-edit-duration').forEach(input => {
                input.addEventListener('change', (e) => {
                    const task = state.tasks.find(t => t.id === e.target.dataset.id);
                    if (task && task.type !== 'milestone') {
                        let val = parseInt(e.target.value);
                        if (isNaN(val)) val = 1;
                        val = utils.clamp(val, 1, 60);
                        e.target.value = val;
                        task.duration = val;
                        scheduler.calculateSchedule();
                        this.renderListView();
                    }
                });
            });

            container.querySelectorAll('.list-edit-assignee').forEach(input => {
                input.addEventListener('change', (e) => {
                    const task = state.tasks.find(t => t.id === e.target.dataset.id);
                    if (task) {
                        task.assignee = e.target.value;
                        this.renderListView();
                    }
                });
            });

            container.querySelectorAll('.list-edit-progress').forEach(input => {
                input.addEventListener('change', (e) => {
                    const task = state.tasks.find(t => t.id === e.target.dataset.id);
                    if (task) {
                        let val = parseInt(e.target.value);
                        if (isNaN(val)) val = 0;
                        val = utils.clamp(val, 0, 100);
                        if (task.type === 'milestone') {
                            val = val >= 50 ? 100 : 0;
                        }
                        e.target.value = val;
                        task.progress = val;
                        this.renderListView();
                        statsManager.updateStats();
                    }
                });
            });
        },

        openPrintPreview() {
            const overlay = document.getElementById('print-preview-overlay');
            overlay.classList.remove('hidden');
            this.generatePrintPages();
            state.printPreviewState.currentPage = 1;
            this.updatePrintPreviewDisplay();
        },

        closePrintPreview() {
            const overlay = document.getElementById('print-preview-overlay');
            overlay.classList.add('hidden');
        },

        generatePrintPages() {
            const pages = [];
            const container = document.getElementById('print-preview-container');
            container.innerHTML = '';

            if (state.currentView === 'list') {
                pages.push(this.createPrintPage('list', 0, state.tasks.length + state.groups.length));
            } else {
                const totalDays = this.getTimelineDays();
                const daysPerPage = 30;
                const totalPages = Math.max(1, Math.ceil(totalDays / daysPerPage));
                for (let i = 0; i < totalPages; i++) {
                    pages.push(this.createPrintPage(state.currentView, i * daysPerPage, Math.min((i + 1) * daysPerPage, totalDays)));
                }
            }

            state.printPreviewState.pages = pages;
            state.printPreviewState.totalPages = pages.length;

            pages.forEach((page, idx) => {
                const pageEl = document.createElement('div');
                pageEl.className = 'print-page';
                pageEl.dataset.page = idx + 1;
                pageEl.style.display = idx === 0 ? '' : 'none';

                const header = document.createElement('div');
                header.className = 'print-page-header';
                header.innerHTML = `
                    <h2>项目排程甘特图</h2>
                    <span class="print-page-number">第 ${idx + 1} 页 / 共 ${pages.length} 页</span>
                `;
                pageEl.appendChild(header);

                const content = document.createElement('div');
                content.className = 'print-page-content';
                content.innerHTML = page.html;
                pageEl.appendChild(content);

                const footer = document.createElement('div');
                footer.className = 'print-page-footer';
                footer.textContent = `打印日期: ${utils.formatDateTime(new Date())}`;
                pageEl.appendChild(footer);

                container.appendChild(pageEl);
            });
        },

        createPrintPage(view, startDay, endDay) {
            if (view === 'list') {
                return {
                    html: this.renderPrintListView()
                };
            } else {
                return {
                    html: this.renderPrintGanttView(view, startDay, endDay),
                    startDay,
                    endDay
                };
            }
        },

        renderPrintListView() {
            const columns = ['任务名称', '工期(天)', '负责人', '开始日期', '结束日期', '完成度', '前置任务', '状态'];
            let html = '<table class="list-view-table" style="width:100%;border-collapse:collapse;"><thead><tr>';
            columns.forEach(col => {
                html += `<th style="padding:8px 10px;border:1px solid #dcdfe6;background:#fafbfc;font-weight:600;text-align:left;font-size:12px;">${col}</th>`;
            });
            html += '</tr></thead><tbody>';

            state.groups.forEach(group => {
                html += `<tr><td colspan="8" style="padding:8px 10px;border:1px solid #dcdfe6;background:#f0f5ff;font-weight:600;font-size:12px;">${this.escapeHtml(group.name)}</td></tr>`;
                if (!group.collapsed) {
                    const groupTasks = state.tasks.filter(t => t.groupId === group.id);
                    groupTasks.forEach(task => {
                        html += this.renderPrintTaskRow(task);
                    });
                }
            });

            const ungrouped = state.tasks.filter(t => !t.groupId);
            ungrouped.forEach(task => {
                html += this.renderPrintTaskRow(task);
            });

            html += '</tbody></table>';
            return html;
        },

        renderPrintTaskRow(task) {
            const startDate = utils.formatDate(utils.addDays(state.projectStart, task._startDay));
            const effDuration = utils.getEffectiveDuration(task);
            const endDate = utils.formatDate(utils.addDays(state.projectStart, task._startDay + effDuration));
            const status = utils.getTaskStatus(task);
            const statusText = status === 'completed' ? '已完成' : (status === 'lagging' ? '滞后' : '进行中');
            const predecessors = utils.getPredecessorNames(task.id);
            const progress = task.progress || 0;
            const durationDisplay = task.type === 'milestone' ? '里程碑' : task.duration;

            return `<tr>
                <td style="padding:6px 10px;border:1px solid #ebeef5;font-size:12px;">${this.escapeHtml(task.name)}</td>
                <td style="padding:6px 10px;border:1px solid #ebeef5;font-size:12px;">${durationDisplay}</td>
                <td style="padding:6px 10px;border:1px solid #ebeef5;font-size:12px;">${this.escapeHtml(task.assignee || '')}</td>
                <td style="padding:6px 10px;border:1px solid #ebeef5;font-size:12px;">${startDate}</td>
                <td style="padding:6px 10px;border:1px solid #ebeef5;font-size:12px;">${endDate}</td>
                <td style="padding:6px 10px;border:1px solid #ebeef5;font-size:12px;">${progress}%</td>
                <td style="padding:6px 10px;border:1px solid #ebeef5;font-size:12px;">${this.escapeHtml(predecessors) || '-'}</td>
                <td style="padding:6px 10px;border:1px solid #ebeef5;font-size:12px;">${statusText}</td>
            </tr>`;
        },

        renderPrintGanttView(view, startDay, endDay) {
            const unitWidth = view === 'week' ? (WEEK_WIDTH / 7) : DAY_WIDTH;
            const daysCount = endDay - startDay;
            const width = daysCount * unitWidth;
            const rows = layoutManager.getVisibleRows();
            let html = '';

            html += '<div style="display:flex;border-bottom:1px solid #e4e7ed;background:#fafbfc;">';
            html += `<div style="min-width:180px;padding:10px 16px;border-right:1px solid #ebeef5;font-size:12px;font-weight:600;color:#909399;">任务</div>`;
            html += `<div style="flex:1;overflow:hidden;position:relative;">`;
            for (let d = startDay; d < endDay; d++) {
                const date = utils.addDays(state.projectStart, d);
                html += `<div style="position:absolute;top:8px;left:${(d - startDay) * unitWidth + unitWidth / 2}px;transform:translateX(-50%);font-size:10px;color:#909399;">${date.getDate()}</div>`;
            }
            html += '</div></div>';

            html += `<div style="position:relative;">`;
            rows.forEach(row => {
                const rowHeight = row.type === 'group-summary' ? GROUP_SUMMARY_HEIGHT : TASK_HEIGHT;
                html += `<div style="display:flex;height:${rowHeight}px;border-bottom:1px solid #f0f2f5;">`;

                if (row.type === 'group-summary') {
                    const toggleChar = row.group.collapsed ? '▶' : '▼';
                    html += `<div style="min-width:180px;padding:0 16px;display:flex;align-items:center;border-right:1px solid #ebeef5;background:#f0f2f5;font-size:12px;font-weight:600;color:#606266;"><span style="width:16px;">${toggleChar}</span>${this.escapeHtml(row.group.name)}</div>`;
                } else if (row.type === 'resource') {
                    html += `<div style="min-width:180px;padding:0 16px;display:flex;align-items:center;border-right:1px solid #ebeef5;background:#fafbfc;font-size:12px;font-weight:600;color:#303133;">${this.escapeHtml(row.key || '未分配')}</div>`;
                } else {
                    const prefix = row.task.type === 'milestone' ? '◆ ' : '';
                    html += `<div style="min-width:180px;padding:0 16px;display:flex;align-items:center;border-right:1px solid #ebeef5;font-size:12px;color:#606266;${row.inGroup ? 'padding-left:32px;' : ''}">${prefix}${this.escapeHtml(row.task.name)}</div>`;
                }

                html += `<div style="flex:1;position:relative;">`;
                if (row.type === 'group-summary') {
                    const range = groupManager.getGroupTimeRange(row.group.id);
                    if (range && range.end >= range.start) {
                        const barLeft = Math.max(0, (range.start - startDay) * unitWidth);
                        const barWidth = Math.min(width - barLeft, (range.end - range.start) * unitWidth);
                        html += `<div style="position:absolute;top:50%;transform:translateY(-50%);left:${barLeft}px;width:${barWidth}px;height:18px;background:rgba(144,147,153,0.35);border:1px solid rgba(144,147,153,0.5);border-radius:4px;"></div>`;
                    }
                } else if (row.type === 'task' && row.task.type !== 'milestone') {
                    const task = row.task;
                    const barLeft = Math.max(0, (task._startDay - startDay) * unitWidth);
                    const barWidth = Math.min(width - barLeft, (task.duration || 1) * unitWidth);
                    const bgColor = task._isCritical ? '#f56c6c' : '#67c23a';
                    const progress = task.progress || 0;
                    html += `<div style="position:absolute;top:50%;transform:translateY(-50%);left:${barLeft}px;width:${barWidth}px;height:28px;background:${bgColor};border-radius:4px;display:flex;align-items:center;padding:0 8px;font-size:11px;color:#fff;font-weight:500;overflow:hidden;">
                        <div style="position:absolute;top:0;left:0;height:100%;background:rgba(0,0,0,0.25);width:${progress}%;border-radius:4px 0 0 4px;"></div>
                        <span style="position:relative;z-index:2;">${this.escapeHtml(task.name)}</span>
                    </div>`;
                } else if (row.type === 'task' && row.task.type === 'milestone') {
                    const task = row.task;
                    const markerLeft = Math.max(0, (task._startDay - startDay) * unitWidth);
                    html += `<div style="position:absolute;top:50%;transform:translateY(-50%) rotate(45deg);left:${markerLeft}px;width:18px;height:18px;background:${task._isCritical ? '#f56c6c' : '#e6a23c'};border:2px solid ${task._isCritical ? '#c03434' : '#a87418'};"></div>`;
                }
                html += `</div></div>`;
            });
            html += `</div>`;
            return html;
        },

        updatePrintPreviewDisplay() {
            const pages = document.querySelectorAll('#print-preview-container .print-page');
            pages.forEach((page, idx) => {
                page.style.display = (idx + 1 === state.printPreviewState.currentPage) ? '' : 'none';
            });
            const info = document.getElementById('print-page-info');
            if (info) {
                info.textContent = `${state.printPreviewState.currentPage} / ${state.printPreviewState.totalPages}`;
            }
            document.getElementById('btn-print-prev').disabled = state.printPreviewState.currentPage <= 1;
            document.getElementById('btn-print-next').disabled = state.printPreviewState.currentPage >= state.printPreviewState.totalPages;
        },

        prevPrintPage() {
            if (state.printPreviewState.currentPage > 1) {
                state.printPreviewState.currentPage--;
                this.updatePrintPreviewDisplay();
            }
        },

        nextPrintPage() {
            if (state.printPreviewState.currentPage < state.printPreviewState.totalPages) {
                state.printPreviewState.currentPage++;
                this.updatePrintPreviewDisplay();
            }
        },

        doPrint() {
            window.print();
        }
    };

    const taskManager = {
        addTask(type = 'task') {
            if (state.tasks.length >= MAX_TASKS) {
                utils.showToast(`任务数量已达上限 ${MAX_TASKS}`, 'error');
                return;
            }
            const isMilestone = type === 'milestone';
            const task = {
                id: utils.uid(),
                name: isMilestone ? `里程碑 ${state.tasks.filter(t => t.type === 'milestone').length + 1}` : `任务 ${state.tasks.filter(t => t.type !== 'milestone').length + 1}`,
                type: isMilestone ? 'milestone' : 'task',
                duration: isMilestone ? 0 : 3,
                assignee: '',
                earliestStartDate: null,
                groupId: null,
                progress: 0,
                _startDay: 0,
                _endDay: isMilestone ? 0 : 3,
                _isCritical: false
            };
            state.tasks.push(task);
            state.selectedTaskId = task.id;
            renderer.renderAll();
            statsManager.updateStats();
        },

        deleteTask(taskId) {
            if (!confirm('确定删除此任务？')) return;
            state.tasks = state.tasks.filter(t => t.id !== taskId);
            state.dependencies = state.dependencies.filter(
                d => d.from !== taskId && d.to !== taskId
            );
            if (state.selectedTaskId === taskId) state.selectedTaskId = null;
            renderer.renderAll();
            statsManager.updateStats();
        },

        setTaskProgress(taskId, progress) {
            const task = state.tasks.find(t => t.id === taskId);
            if (!task) return;
            let val = parseInt(progress);
            if (isNaN(val)) val = 0;
            val = utils.clamp(val, 0, 100);
            if (task.type === 'milestone') {
                val = val >= 50 ? 100 : 0;
            }
            task.progress = val;
            renderer.renderGantt();
            renderer.renderTaskList();
            statsManager.updateStats();
        },

        addDependency(fromId, toId) {
            const exists = state.dependencies.some(
                d => d.from === fromId && d.to === toId
            );
            if (exists) {
                utils.showToast('依赖关系已存在', 'error');
                return;
            }
            state.dependencies.push({
                id: utils.uid(),
                from: fromId,
                to: toId
            });
            renderer.renderAll();
            utils.showToast('依赖创建成功', 'success');
        },

        deleteDependency(depId) {
            state.dependencies = state.dependencies.filter(d => d.id !== depId);
            state.selectedDepId = null;
            renderer.renderAll();
        }
    };

    const io = {
        exportJSON() {
            const data = {
                projectStart: utils.formatDate(state.projectStart),
                tasks: state.tasks.map(t => ({
                    id: t.id,
                    name: t.name,
                    type: t.type || 'task',
                    duration: t.duration,
                    assignee: t.assignee,
                    groupId: t.groupId || null,
                    earliestStartDate: t.earliestStartDate ?
                        utils.formatDate(new Date(t.earliestStartDate)) : null,
                    progress: t.progress || 0
                })),
                groups: state.groups.map(g => ({
                    id: g.id,
                    name: g.name,
                    collapsed: g.collapsed
                })),
                dependencies: state.dependencies.map(d => ({
                    id: d.id,
                    from: d.from,
                    to: d.to
                })),
                baselines: state.baselines.map(b => ({
                    id: b.id,
                    name: b.name,
                    savedAt: b.savedAt,
                    tasks: b.tasks
                }))
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gantt-project-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            utils.showToast('导出成功', 'success');
        },

        importJSON(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.tasks || !Array.isArray(data.tasks)) {
                        throw new Error('格式错误：缺少 tasks');
                    }
                    if (!data.dependencies || !Array.isArray(data.dependencies)) {
                        throw new Error('格式错误：缺少 dependencies');
                    }

                    const oldTasks = JSON.parse(JSON.stringify(state.tasks));
                    const oldDeps = JSON.parse(JSON.stringify(state.dependencies));
                    const oldGroups = JSON.parse(JSON.stringify(state.groups));
                    const oldBaselines = JSON.parse(JSON.stringify(state.baselines));
                    const oldStart = new Date(state.projectStart);

                    state.tasks = data.tasks.map(t => ({
                        ...t,
                        type: t.type || 'task',
                        groupId: t.groupId || null,
                        earliestStartDate: t.earliestStartDate ? new Date(t.earliestStartDate) : null,
                        progress: t.progress !== undefined ? t.progress : 0,
                        _startDay: 0,
                        _endDay: 0,
                        _isCritical: false
                    }));
                    state.groups = Array.isArray(data.groups) ? data.groups.map(g => ({
                        id: g.id,
                        name: g.name,
                        collapsed: !!g.collapsed
                    })) : [];
                    state.dependencies = data.dependencies;
                    state.baselines = Array.isArray(data.baselines) ? data.baselines.map(b => ({
                        id: b.id,
                        name: b.name,
                        savedAt: b.savedAt,
                        tasks: b.tasks || []
                    })) : [];
                    state.selectedBaselineId = null;
                    if (data.projectStart) {
                        state.projectStart = new Date(data.projectStart);
                    }

                    const validGroupIds = new Set(state.groups.map(g => g.id));
                    state.tasks.forEach(t => {
                        if (t.groupId && !validGroupIds.has(t.groupId)) {
                            t.groupId = null;
                        }
                        if (t.progress === undefined) t.progress = 0;
                    });

                    const cycle = scheduler.detectCycle();
                    if (cycle) {
                        const cycleNames = cycle.map(id => {
                            const t = state.tasks.find(x => x.id === id);
                            return t ? t.name : id;
                        }).join(' → ');

                        state.tasks = oldTasks;
                        state.dependencies = oldDeps;
                        state.groups = oldGroups;
                        state.baselines = oldBaselines;
                        state.projectStart = oldStart;

                        utils.flashScreen();
                        utils.showToast('导入失败：存在循环依赖: ' + cycleNames, 'error');
                        return;
                    }

                    state.selectedTaskId = null;
                    state.selectedDepId = null;
                    utils.syncIdCounter();
                    baselineManager.renderBaselineList();
                    renderer.renderAll();
                    utils.showToast(`成功导入 ${state.tasks.length} 个任务${state.groups.length ? `，${state.groups.length} 个分组` : ''}${state.baselines.length ? `，${state.baselines.length} 份基线` : ''}`, 'success');
                } catch (err) {
                    utils.showToast('导入失败: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        }
    };

    function initEvents() {
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                renderer.switchView(btn.dataset.view);
            });
        });

        document.getElementById('btn-print-preview').addEventListener('click', () => {
            renderer.openPrintPreview();
        });

        document.getElementById('btn-print-close').addEventListener('click', () => {
            renderer.closePrintPreview();
        });

        document.getElementById('btn-print-prev').addEventListener('click', () => {
            renderer.prevPrintPage();
        });

        document.getElementById('btn-print-next').addEventListener('click', () => {
            renderer.nextPrintPage();
        });

        document.getElementById('btn-print-do').addEventListener('click', () => {
            renderer.doPrint();
        });

        document.getElementById('btn-add-task').addEventListener('click', () => {
            const typeSelect = document.getElementById('select-task-type');
            const type = typeSelect ? typeSelect.value : 'task';
            taskManager.addTask(type);
        });

        document.getElementById('btn-add-group').addEventListener('click', () => {
            const name = prompt('请输入分组名称：', `分组 ${state.groups.length + 1}`);
            if (name !== null) {
                groupManager.addGroup(name);
                utils.showToast('分组创建成功', 'success');
            }
        });

        document.getElementById('btn-view-toggle').addEventListener('click', (e) => {
            state.isResourceView = !state.isResourceView;
            e.target.textContent = state.isResourceView ? '任务视图' : '资源视图';
            renderer.renderAll();
        });

        document.getElementById('btn-balance').addEventListener('click', () => {
            state.preBalanceState = {
                tasks: state.tasks.map(t => ({
                    id: t.id,
                    _startDay: t._startDay,
                    earliestStartDate: t.earliestStartDate ? new Date(t.earliestStartDate) : null
                })),
                dependencies: state.dependencies.map(d => ({ ...d }))
            };
            resourceManager.autoBalance();
            document.getElementById('btn-undo-balance').disabled = false;
            renderer.renderAll();
            utils.showToast('资源平衡完成', 'success');
        });

        document.getElementById('btn-undo-balance').addEventListener('click', () => {
            if (!state.preBalanceState) return;

            state.preBalanceState.tasks.forEach(saved => {
                const task = state.tasks.find(t => t.id === saved.id);
                if (task) {
                    task._startDay = saved._startDay;
                    task.earliestStartDate = saved.earliestStartDate ?
                        new Date(saved.earliestStartDate) : null;
                }
            });
            state.dependencies = state.preBalanceState.dependencies.map(d => ({ ...d }));
            state.preBalanceState = null;

            document.getElementById('btn-undo-balance').disabled = true;
            scheduler.calculateSchedule();
            renderer.renderAll();
            utils.showToast('已撤销平衡', 'success');
        });

        document.getElementById('btn-export').addEventListener('click', () => {
            io.exportJSON();
        });

        document.getElementById('btn-import').addEventListener('click', () => {
            document.getElementById('file-import').click();
        });

        document.getElementById('file-import').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                io.importJSON(file);
            }
            e.target.value = '';
        });

        document.getElementById('btn-save-baseline').addEventListener('click', () => {
            if (state.baselines.length >= baselineManager.MAX_BASELINES) {
                utils.showToast(`最多只能保存 ${baselineManager.MAX_BASELINES} 份基线，请先删除旧的`, 'error');
                return;
            }
            const name = prompt('请输入基线名称：', `v${state.baselines.length + 1} 版本计划`);
            if (name !== null) {
                baselineManager.saveBaseline(name || '未命名基线');
            }
        });

        const statsHeader = document.getElementById('stats-header');
        if (statsHeader) {
            statsHeader.addEventListener('click', () => {
                statsManager.toggleStats();
            });
        }

        document.getElementById('gantt-canvas').addEventListener('click', (e) => {
            if (!e.target.closest('.task-bar') && !e.target.closest('.milestone-marker') && !e.target.closest('.dep-line')) {
                state.selectedTaskId = null;
                state.selectedDepId = null;
                renderer.renderTaskList();
                renderer.renderGantt();
                renderer.renderDependencies();
            }
        });

        document.addEventListener('keydown', (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') &&
                !e.target.matches('input, textarea')) {
                if (state.selectedDepId) {
                    taskManager.deleteDependency(state.selectedDepId);
                }
            }
        });

        const ganttCanvas = document.getElementById('gantt-canvas');
        const timelineScale = document.getElementById('timeline-scale');
        ganttCanvas.addEventListener('scroll', () => {
            timelineScale.style.transform = `translateX(${-ganttCanvas.scrollLeft}px)`;
        });
    }

    function init() {
        state.projectStart.setHours(0, 0, 0, 0);
        initEvents();
        baselineManager.renderBaselineList();
        renderer.renderAll();
    }

    init();
})();
