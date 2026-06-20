(() => {
    'use strict';

    const DAY_WIDTH = 32;
    const MAX_TASKS = 100;
    const TASK_HEIGHT = 48;

    const state = {
        tasks: [],
        dependencies: [],
        projectStart: new Date(),
        selectedTaskId: null,
        selectedDepId: null,
        isResourceView: false,
        preBalanceState: null,
        dragState: null,
        depDragState: null,
        idCounter: 1
    };

    const utils = {
        uid() {
            return 'id_' + (state.idCounter++);
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
                let earliestDay = 0;
                if (task.earliestStartDate) {
                    earliestDay = Math.max(0, utils.diffDays(state.projectStart, new Date(task.earliestStartDate)));
                }
                const preds = state.dependencies.filter(d => d.to === id);
                preds.forEach(dep => {
                    const predTask = taskMap[dep.from];
                    if (predTask) {
                        const predEnd = predTask._startDay + predTask.duration;
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
                t._endDay = t._startDay + t.duration;
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
                if (successors[id].length === 0) {
                    latestStart[id] = maxEnd - taskMap[id].duration;
                } else {
                    let minSucc = Infinity;
                    successors[id].forEach(s => {
                        if (latestStart[s] < minSucc) minSucc = latestStart[s];
                    });
                    latestStart[id] = minSucc - taskMap[id].duration;
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
                if (t.assignee && t.assignee.trim()) {
                    set.add(t.assignee.trim());
                }
            });
            return [...set];
        }
    };

    const renderer = {
        getTimelineDays() {
            let maxDay = 0;
            state.tasks.forEach(t => {
                const endDay = (t._startDay || 0) + (t.duration || 3);
                if (endDay > maxDay) maxDay = endDay;
            });
            return Math.max(60, maxDay + 30);
        },

        renderAll() {
            scheduler.calculateSchedule();
            this.renderTimeline();
            this.renderTaskList();
            this.renderGantt();
            this.renderDependencies();
            this.updateTaskCount();
        },

        renderTimeline() {
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

        renderTaskList() {
            const list = document.getElementById('task-list');
            const conflicts = resourceManager.findConflicts();

            if (state.tasks.length === 0) {
                list.innerHTML = '<div style="padding:40px 16px;color:#909399;font-size:12px;text-align:center;">暂无任务，点击上方按钮新增</div>';
                return;
            }

            list.innerHTML = '';
            state.tasks.forEach(task => {
                const item = document.createElement('div');
                item.className = 'task-item';
                if (task.id === state.selectedTaskId) {
                    item.classList.add('selected');
                }
                item.dataset.id = task.id;

                const assignee = task.assignee && task.assignee.trim() ? task.assignee.trim() : '';
                const assigneeCount = assignee ? (conflicts[`__assignee__${assignee}`] || 0) : 0;

                item.innerHTML = `
                    <div class="task-item-header">
                        <input type="text" class="task-item-name" value="${this.escapeHtml(task.name)}" />
                        <span class="task-item-delete" title="删除">×</span>
                    </div>
                    <div class="task-item-field">
                        <label>工期(天)</label>
                        <input type="number" class="task-duration" min="1" max="60" value="${task.duration}" />
                    </div>
                    <div class="task-item-field">
                        <label>负责人</label>
                        <div class="assignee-wrapper">
                            <input type="text" class="assignee-input" value="${this.escapeHtml(task.assignee)}" />
                            ${assigneeCount > 0 ? `<span class="conflict-badge">${assigneeCount}</span>` : ''}
                        </div>
                    </div>
                    <div class="task-item-field">
                        <label>最早开始</label>
                        <input type="date" class="task-earliest" value="${task.earliestStartDate ? utils.formatDate(new Date(task.earliestStartDate)) : ''}" />
                    </div>
                `;
                list.appendChild(item);

                const nameInput = item.querySelector('.task-item-name');
                const durInput = item.querySelector('.task-duration');
                const assigneeInput = item.querySelector('.assignee-input');
                const earliestInput = item.querySelector('.task-earliest');
                const delBtn = item.querySelector('.task-item-delete');

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

                durInput.addEventListener('change', (e) => {
                    let val = parseInt(e.target.value);
                    if (isNaN(val)) val = 1;
                    val = utils.clamp(val, 1, 60);
                    e.target.value = val;
                    task.duration = val;
                    this.renderAll();
                });

                assigneeInput.addEventListener('input', (e) => {
                    task.assignee = e.target.value;
                    this.renderAll();
                });

                earliestInput.addEventListener('change', (e) => {
                    task.earliestStartDate = e.target.value ? new Date(e.target.value) : null;
                    this.renderAll();
                });

                delBtn.addEventListener('click', () => {
                    taskManager.deleteTask(task.id);
                });
            });
        },

        renderGantt() {
            const rowsContainer = document.getElementById('gantt-rows');
            const totalDays = this.getTimelineDays();
            const width = totalDays * DAY_WIDTH;
            rowsContainer.innerHTML = '';

            const conflicts = resourceManager.findConflicts();

            if (state.isResourceView) {
                const assignees = resourceManager.getAssignees();
                const hasUnassigned = state.tasks.some(t => !t.assignee || !t.assignee.trim());
                const rowHeaders = [...assignees];
                if (hasUnassigned) rowHeaders.push('未分配');
                if (rowHeaders.length === 0) rowHeaders.push('');

                rowHeaders.forEach(assignee => {
                    const row = document.createElement('div');
                    row.className = 'gantt-row resource-row';

                    const tasks = assignee === '未分配' || assignee === '' ?
                        state.tasks.filter(t => !t.assignee || !t.assignee.trim()) :
                        state.tasks.filter(t => t.assignee && t.assignee.trim() === assignee);

                    const label = document.createElement('div');
                    label.className = 'gantt-row-label';
                    const displayName = assignee || '未分配';
                    const count = assignee && assignee !== '未分配' ?
                        (conflicts[`__assignee__${assignee}`] || 0) : 0;
                    label.textContent = displayName;
                    if (count > 0) {
                        label.innerHTML = `${displayName} <span class="conflict-badge">${count}</span>`;
                    }
                    row.appendChild(label);

                    const grid = document.createElement('div');
                    grid.className = 'gantt-row-grid';
                    grid.style.width = width + 'px';
                    this.renderGridColumns(grid, totalDays);
                    tasks.forEach(task => {
                        this.renderTaskBar(grid, task, conflicts);
                    });
                    row.appendChild(grid);
                    rowsContainer.appendChild(row);
                });
            } else {
                state.tasks.forEach(task => {
                    const row = document.createElement('div');
                    row.className = 'gantt-row';

                    const label = document.createElement('div');
                    label.className = 'gantt-row-label';
                    label.textContent = task.name || '未命名任务';
                    row.appendChild(label);

                    const grid = document.createElement('div');
                    grid.className = 'gantt-row-grid';
                    grid.style.width = width + 'px';
                    grid.dataset.taskId = task.id;
                    this.renderGridColumns(grid, totalDays);
                    this.renderTaskBar(grid, task, conflicts);
                    row.appendChild(grid);
                    rowsContainer.appendChild(row);
                });
            }
        },

        renderGridColumns(grid, totalDays) {
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
        },

        renderTaskBar(grid, task, conflicts) {
            const bar = document.createElement('div');
            bar.className = 'task-bar';
            bar.dataset.id = task.id;

            if (task._isCritical) bar.classList.add('critical');
            if (task.id === state.selectedTaskId) bar.classList.add('selected');

            bar.style.left = (task._startDay * DAY_WIDTH) + 'px';
            bar.style.width = (task.duration * DAY_WIDTH) + 'px';

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
                warning.style.width = (task.duration * DAY_WIDTH) + 'px';
                bar.appendChild(warning);
            }

            this.attachTaskBarEvents(bar, task, handleEnd);
            grid.appendChild(bar);
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
                    const dayDelta = Math.round(dx / DAY_WIDTH);
                    let newStart = originalStartDay + dayDelta;
                    newStart = Math.max(0, newStart);
                    const minValid = this.getMinValidStart(task.id);
                    const isValid = newStart >= minValid;

                    state.dragState.currentStartDay = newStart;
                    state.dragState.isValid = isValid;

                    bar.style.left = (newStart * DAY_WIDTH) + 'px';
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

                const onMove = (ev) => {
                    if (!state.depDragState) return;

                    const canvas = document.getElementById('gantt-canvas');
                    const rect = canvas.getBoundingClientRect();

                    const fromRow = this.getTaskRowIndex(task.id);
                    const fromX1 = (task._startDay + task.duration) * DAY_WIDTH;
                    const fromY = fromRow * TASK_HEIGHT + TASK_HEIGHT / 2;

                    const toX = ev.clientX - rect.left + canvas.scrollLeft;
                    const toY = ev.clientY - rect.top + canvas.scrollTop;

                    const midX = (fromX1 + toX) / 2;
                    const d = `M ${fromX1} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;
                    preview.setAttribute('d', d);

                    const target = document.elementFromPoint(ev.clientX, ev.clientY);
                    const taskBar = target ? target.closest('.task-bar') : null;
                    state.depDragState.toId = taskBar ? taskBar.dataset.id : null;
                };

                const onUp = (ev) => {
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
            });
        },

        getTaskRowIndex(taskId) {
            if (state.isResourceView) {
                const assignees = resourceManager.getAssignees();
                const hasUnassigned = state.tasks.some(t => !t.assignee || !t.assignee.trim());
                const task = state.tasks.find(t => t.id === taskId);
                const assignee = task.assignee && task.assignee.trim() ? task.assignee.trim() : '未分配';

                if (task.assignee && task.assignee.trim()) {
                    return assignees.indexOf(assignee);
                } else {
                    return assignees.length;
                }
            }
            return state.tasks.findIndex(t => t.id === taskId);
        },

        getMinValidStart(taskId) {
            const preds = state.dependencies.filter(d => d.to === taskId);
            let minDay = 0;
            preds.forEach(dep => {
                const pred = state.tasks.find(t => t.id === dep.from);
                if (pred) {
                    const end = pred._startDay + pred.duration;
                    if (end > minDay) minDay = end;
                }
            });
            return minDay;
        },

        renderDependencies() {
            const svg = document.getElementById('dependency-svg');
            const totalDays = this.getTimelineDays();
            let totalRows;

            if (state.isResourceView) {
                const assignees = resourceManager.getAssignees();
                const hasUnassigned = state.tasks.some(t => !t.assignee || !t.assignee.trim());
                totalRows = assignees.length + (hasUnassigned ? 1 : 0);
            } else {
                totalRows = state.tasks.length;
            }
            totalRows = Math.max(1, totalRows);

            svg.setAttribute('width', totalDays * DAY_WIDTH);
            svg.setAttribute('height', totalRows * TASK_HEIGHT + 100);
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

                const fromRow = this.getTaskRowIndex(dep.from);
                const toRow = this.getTaskRowIndex(dep.to);

                const fromX = (fromTask._startDay + fromTask.duration) * DAY_WIDTH;
                const fromY = fromRow * TASK_HEIGHT + TASK_HEIGHT / 2;
                const toX = toTask._startDay * DAY_WIDTH;
                const toY = toRow * TASK_HEIGHT + TASK_HEIGHT / 2;

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
            document.getElementById('task-count').textContent =
                `${state.tasks.length} / ${MAX_TASKS} 个任务`;
        },

        escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str || '';
            return div.innerHTML;
        }
    };

    const taskManager = {
        addTask() {
            if (state.tasks.length >= MAX_TASKS) {
                utils.showToast(`任务数量已达上限 ${MAX_TASKS}`, 'error');
                return;
            }
            const task = {
                id: utils.uid(),
                name: `任务 ${state.tasks.length + 1}`,
                duration: 3,
                assignee: '',
                earliestStartDate: null,
                _startDay: 0,
                _endDay: 3,
                _isCritical: false
            };
            state.tasks.push(task);
            state.selectedTaskId = task.id;
            renderer.renderAll();
        },

        deleteTask(taskId) {
            if (!confirm('确定删除此任务？')) return;
            state.tasks = state.tasks.filter(t => t.id !== taskId);
            state.dependencies = state.dependencies.filter(
                d => d.from !== taskId && d.to !== taskId
            );
            if (state.selectedTaskId === taskId) state.selectedTaskId = null;
            renderer.renderAll();
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
                    duration: t.duration,
                    assignee: t.assignee,
                    earliestStartDate: t.earliestStartDate ?
                        utils.formatDate(new Date(t.earliestStartDate)) : null
                })),
                dependencies: state.dependencies.map(d => ({
                    id: d.id,
                    from: d.from,
                    to: d.to
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
                    const oldStart = new Date(state.projectStart);

                    state.tasks = data.tasks.map(t => ({
                        ...t,
                        earliestStartDate: t.earliestStartDate ? new Date(t.earliestStartDate) : null,
                        _startDay: 0,
                        _endDay: 0,
                        _isCritical: false
                    }));
                    state.dependencies = data.dependencies;
                    if (data.projectStart) {
                        state.projectStart = new Date(data.projectStart);
                    }

                    const cycle = scheduler.detectCycle();
                    if (cycle) {
                        const cycleNames = cycle.map(id => {
                            const t = state.tasks.find(x => x.id === id);
                            return t ? t.name : id;
                        }).join(' → ');

                        state.tasks = oldTasks;
                        state.dependencies = oldDeps;
                        state.projectStart = oldStart;

                        utils.flashScreen();
                        utils.showToast('导入失败：存在循环依赖: ' + cycleNames, 'error');
                        return;
                    }

                    state.selectedTaskId = null;
                    state.selectedDepId = null;
                    renderer.renderAll();
                    utils.showToast(`成功导入 ${state.tasks.length} 个任务`, 'success');
                } catch (err) {
                    utils.showToast('导入失败: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
        }
    };

    function initEvents() {
        document.getElementById('btn-add-task').addEventListener('click', () => {
            taskManager.addTask();
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

        document.getElementById('gantt-canvas').addEventListener('click', (e) => {
            if (!e.target.closest('.task-bar') && !e.target.closest('.dep-line')) {
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
    }

    function init() {
        state.projectStart.setHours(0, 0, 0, 0);
        initEvents();
        renderer.renderAll();
    }

    init();
})();
