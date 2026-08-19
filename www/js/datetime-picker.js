/*
 * datetime-picker.js — кастомный выбор даты/времени напоминания взамен
 * системной крутилки <input type="datetime-local">.
 *
 * Повторяет интеракцию стандартного пикера времени Android: сначала
 * календарь (тап по дню), затем круглый циферблат 0–23 (два кольца —
 * внешнее 0–11, внутреннее 12–23), перетаскивание стрелки меняет час/
 * минуту в реальном времени.
 *
 * Публичный API:
 *   DateTimePicker.pick(initialTimestamp, { canClear }) -> Promise<result>
 *   result: number (новый timestamp) | 'clear' (убрать напоминание) | null (отмена)
 *
 * Полностью самодостаточен: строит свой DOM в document.body при открытии,
 * удаляет при закрытии. Ничего не хранит между вызовами.
 */
const DateTimePicker = (() => {
  const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  const DIAL_SIZE = 280;
  const CENTER = DIAL_SIZE / 2;
  const OUTER_R = 108;
  const INNER_R = 70;
  const RING_THRESHOLD = (OUTER_R + INNER_R) / 2;

  function pad2(n) { return String(n).padStart(2, '0'); }

  function polar(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
  }

  function angleFromPointer(cx, cy, px, py) {
    const dx = px - cx, dy = py - cy;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    return { deg, dist: Math.sqrt(dx * dx + dy * dy) };
  }

  function pick(initialTimestamp, opts) {
    opts = opts || {};
    const canClear = !!opts.canClear;
    const initial = new Date(initialTimestamp || Date.now() + 30 * 60000);

    return new Promise((resolve) => {
      let settled = false;
      const state = {
        step: 'calendar',                 // 'calendar' | 'time'
        segment: 'hour',                  // 'hour' | 'minute' (active dial segment)
        manualEntry: false,
        viewYear: initial.getFullYear(),
        viewMonth: initial.getMonth(),
        selDate: new Date(initial.getFullYear(), initial.getMonth(), initial.getDate()),
        hour: initial.getHours(),
        minute: initial.getMinutes(),
      };

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      const sheet = document.createElement('div');
      sheet.className = 'modal-sheet picker-sheet';
      backdrop.appendChild(sheet);
      document.body.appendChild(backdrop);

      // Собственный слой в истории поверх редактора: системный жест "назад"
      // должен закрывать сначала именно пикер (или сначала откатывать шаг
      // "время" -> "календарь"), а не весь редактор разом — см. popstate
      // ниже и общий слушатель в app.js.
      let ownsHistoryEntry = true;
      history.pushState({ subview: 'picker' }, '');

      function onPopState() {
        if (state.step === 'time') {
          // Один шаг назад внутри пикера: возвращаемся к календарю и
          // восстанавливаем свою запись в истории для следующего "назад".
          state.step = 'calendar';
          render();
          history.pushState({ subview: 'picker' }, '');
          return;
        }
        ownsHistoryEntry = false; // запись уже выскочила из стека сама
        close(null);
      }
      window.addEventListener('popstate', onPopState);

      function close(result) {
        if (settled) return;
        settled = true;
        window.removeEventListener('popstate', onPopState);
        backdrop.remove();
        if (ownsHistoryEntry) {
          // Закрытие через кнопку/тап мимо, а не через системный "назад" —
          // свою запись из истории нужно убрать самим, чтобы стек не разъезжался.
          history.back();
        }
        resolve(result);
      }

      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });

      function render() {
        sheet.innerHTML = '';
        if (state.step === 'calendar') renderCalendar(sheet);
        else renderTime(sheet);
      }

      // ---------- Calendar screen ----------
      function renderCalendar(root) {
        const header = document.createElement('div');
        header.className = 'picker-header';
        const prevBtn = iconBtn('‹');
        const nextBtn = iconBtn('›');
        const title = document.createElement('div');
        title.className = 'picker-title';
        title.textContent = `${MONTHS[state.viewMonth]} ${state.viewYear}`;
        prevBtn.addEventListener('click', () => { shiftMonth(-1); render(); });
        nextBtn.addEventListener('click', () => { shiftMonth(1); render(); });
        header.appendChild(prevBtn);
        header.appendChild(title);
        header.appendChild(nextBtn);
        root.appendChild(header);

        const weekRow = document.createElement('div');
        weekRow.className = 'picker-weekdays';
        WEEKDAYS.forEach((w) => {
          const c = document.createElement('span');
          c.textContent = w;
          weekRow.appendChild(c);
        });
        root.appendChild(weekRow);

        const grid = document.createElement('div');
        grid.className = 'picker-days';
        buildMonthDays(state.viewYear, state.viewMonth).forEach((d) => {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'picker-day';
          if (!d.inMonth) cell.classList.add('dim');
          if (d.isToday) cell.classList.add('today');
          if (sameDate(d.date, state.selDate)) cell.classList.add('selected');
          cell.textContent = String(d.date.getDate());
          cell.addEventListener('click', () => {
            state.selDate = d.date;
            if (!d.inMonth) { state.viewYear = d.date.getFullYear(); state.viewMonth = d.date.getMonth(); }
            render();
          });
          grid.appendChild(cell);
        });
        root.appendChild(grid);

        const footer = document.createElement('div');
        footer.className = 'picker-footer';
        if (canClear) {
          const clearLink = document.createElement('button');
          clearLink.type = 'button';
          clearLink.className = 'picker-link';
          clearLink.textContent = 'Убрать напоминание';
          clearLink.addEventListener('click', () => close('clear'));
          footer.appendChild(clearLink);
        }
        const spacer = document.createElement('div');
        spacer.className = 'picker-footer-spacer';
        footer.appendChild(spacer);
        const cancelBtn = textBtn('Отмена', () => close(null));
        const nextStepBtn = textBtn('Далее', () => { state.step = 'time'; render(); }, true);
        footer.appendChild(cancelBtn);
        footer.appendChild(nextStepBtn);
        root.appendChild(footer);
      }

      function shiftMonth(delta) {
        let m = state.viewMonth + delta, y = state.viewYear;
        if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
        state.viewMonth = m; state.viewYear = y;
      }

      function buildMonthDays(year, month) {
        const first = new Date(year, month, 1);
        const startOffset = (first.getDay() + 6) % 7; // Monday-first
        const gridStart = new Date(year, month, 1 - startOffset);
        const today = new Date();
        const days = [];
        for (let i = 0; i < 42; i++) {
          const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
          days.push({
            date: d,
            inMonth: d.getMonth() === month,
            isToday: sameDate(d, today),
          });
        }
        return days;
      }

      function sameDate(a, b) {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      }

      // ---------- Time (clock dial) screen ----------
      function renderTime(root) {
        const header = document.createElement('div');
        header.className = 'picker-header';
        const backBtn = iconBtn('‹');
        backBtn.addEventListener('click', () => { state.step = 'calendar'; render(); });
        const title = document.createElement('div');
        title.className = 'picker-title';
        title.textContent = 'Выбор времени';
        header.appendChild(backBtn);
        header.appendChild(title);
        header.appendChild(iconBtnPlaceholder());
        root.appendChild(header);

        const digital = document.createElement('div');
        digital.className = 'picker-digital';
        const hourSeg = document.createElement('button');
        hourSeg.type = 'button';
        hourSeg.className = 'picker-digital-seg' + (state.segment === 'hour' ? ' active' : '');
        hourSeg.textContent = pad2(state.hour);
        hourSeg.addEventListener('click', () => { state.segment = 'hour'; render(); });
        const colon = document.createElement('span');
        colon.className = 'picker-digital-colon';
        colon.textContent = ':';
        const minSeg = document.createElement('button');
        minSeg.type = 'button';
        minSeg.className = 'picker-digital-seg' + (state.segment === 'minute' ? ' active' : '');
        minSeg.textContent = pad2(state.minute);
        minSeg.addEventListener('click', () => { state.segment = 'minute'; render(); });
        digital.appendChild(hourSeg);
        digital.appendChild(colon);
        digital.appendChild(minSeg);
        root.appendChild(digital);

        if (state.manualEntry) {
          root.appendChild(buildManualEntry());
        } else {
          root.appendChild(buildDial());
        }

        const footer = document.createElement('div');
        footer.className = 'picker-footer';
        const kbdBtn = iconBtn(state.manualEntry ? '◷' : '⌨');
        kbdBtn.classList.add('picker-mode-toggle');
        kbdBtn.setAttribute('aria-label', state.manualEntry ? 'Циферблат' : 'Ввести вручную');
        kbdBtn.addEventListener('click', () => { state.manualEntry = !state.manualEntry; render(); });
        footer.appendChild(kbdBtn);

        const soundBtn = document.createElement('button');
        soundBtn.type = 'button';
        soundBtn.className = 'picker-link picker-sound-btn';
        soundBtn.textContent = 'Мелодия';
        soundBtn.addEventListener('click', async () => {
          soundBtn.disabled = true;
          const original = soundBtn.textContent;
          try {
            const uri = (typeof Reminders !== 'undefined' && Reminders.pickCustomSound) ? await Reminders.pickCustomSound() : null;
            soundBtn.textContent = uri ? 'Мелодия выбрана ✓' : 'Отменено';
          } catch (e) {
            soundBtn.textContent = 'Не удалось';
          }
          setTimeout(() => { soundBtn.textContent = original; soundBtn.disabled = false; }, 1600);
        });
        footer.appendChild(soundBtn);

        const spacer = document.createElement('div');
        spacer.className = 'picker-footer-spacer';
        footer.appendChild(spacer);

        const cancelBtn = textBtn('Отмена', () => close(null));
        const okBtn = textBtn('ОК', () => {
          const result = new Date(state.selDate.getFullYear(), state.selDate.getMonth(), state.selDate.getDate(), state.hour, state.minute, 0, 0).getTime();
          close(result);
        }, true);
        footer.appendChild(cancelBtn);
        footer.appendChild(okBtn);
        root.appendChild(footer);
      }

      function buildManualEntry() {
        const wrap = document.createElement('div');
        wrap.className = 'picker-manual';
        const hourInput = document.createElement('input');
        hourInput.type = 'number'; hourInput.min = '0'; hourInput.max = '23';
        hourInput.className = 'picker-manual-input';
        hourInput.value = pad2(state.hour);
        hourInput.addEventListener('input', () => {
          const v = Math.max(0, Math.min(23, parseInt(hourInput.value, 10) || 0));
          state.hour = v;
        });
        const sep = document.createElement('span');
        sep.className = 'picker-digital-colon';
        sep.textContent = ':';
        const minInput = document.createElement('input');
        minInput.type = 'number'; minInput.min = '0'; minInput.max = '59';
        minInput.className = 'picker-manual-input';
        minInput.value = pad2(state.minute);
        minInput.addEventListener('input', () => {
          const v = Math.max(0, Math.min(59, parseInt(minInput.value, 10) || 0));
          state.minute = v;
        });
        wrap.appendChild(hourInput);
        wrap.appendChild(sep);
        wrap.appendChild(minInput);
        return wrap;
      }

      function buildDial() {
        const dial = document.createElement('div');
        dial.className = 'picker-dial';
        dial.style.width = DIAL_SIZE + 'px';
        dial.style.height = DIAL_SIZE + 'px';

        const isHour = state.segment === 'hour';
        const slots = 12;
        for (let i = 0; i < slots; i++) {
          const angle = i * 30;
          if (isHour) {
            addDialNumber(dial, angle, OUTER_R, i, false);
            addDialNumber(dial, angle, INNER_R, i + 12, true);
          } else {
            addDialNumber(dial, angle, OUTER_R, i * 5, false);
          }
        }

        const hand = document.createElement('div');
        hand.className = 'picker-hand';
        const chip = document.createElement('div');
        chip.className = 'picker-chip';
        dial.appendChild(hand);
        dial.appendChild(chip);

        function currentValue() {
          return isHour ? state.hour : state.minute;
        }
        function ringRadiusForValue(v) {
          if (!isHour) return OUTER_R;
          return v < 12 ? OUTER_R : INNER_R;
        }
        function updateHand() {
          const v = currentValue();
          const angle = isHour ? (v % 12) * 30 : v * 6;
          const r = ringRadiusForValue(v);
          const p = polar(CENTER, CENTER, r, angle);
          hand.style.width = r + 'px';
          hand.style.transform = `translate(0, -1px) rotate(${angle - 90}deg)`;
          chip.style.left = p.x + 'px';
          chip.style.top = p.y + 'px';
          chip.textContent = isHour ? String(v) : pad2(v);
        }
        updateHand();

        let dragging = false;
        function pointerToValue(clientX, clientY) {
          const rect = dial.getBoundingClientRect();
          const cx = rect.left + DIAL_SIZE / 2, cy = rect.top + DIAL_SIZE / 2;
          const { deg, dist } = angleFromPointer(cx, cy, clientX, clientY);
          if (isHour) {
            const slot = Math.round(deg / 30) % 12;
            const isOuterRing = dist >= RING_THRESHOLD;
            return isOuterRing ? slot : slot + 12;
          }
          let minute = Math.round(deg / 6) % 60;
          if (minute < 0) minute += 60;
          return minute;
        }

        function onMove(clientX, clientY) {
          const v = pointerToValue(clientX, clientY);
          if (isHour) state.hour = v; else state.minute = v;
          updateHand();
          hourSegSync();
        }
        function hourSegSync() {
          const hourSeg = sheet.querySelector('.picker-digital-seg:first-of-type');
          const minSeg = sheet.querySelector('.picker-digital-seg:last-of-type');
          if (hourSeg) hourSeg.textContent = pad2(state.hour);
          if (minSeg) minSeg.textContent = pad2(state.minute);
        }

        dial.addEventListener('pointerdown', (e) => {
          dragging = true;
          try { dial.setPointerCapture(e.pointerId); } catch (err) {}
          onMove(e.clientX, e.clientY);
        });
        dial.addEventListener('pointermove', (e) => {
          if (!dragging) return;
          onMove(e.clientX, e.clientY);
        });
        function endDrag(e) {
          if (!dragging) return;
          dragging = false;
          try { dial.releasePointerCapture(e.pointerId); } catch (err) {}
          if (isHour) {
            state.segment = 'minute';
            render();
          }
        }
        dial.addEventListener('pointerup', endDrag);
        dial.addEventListener('pointercancel', endDrag);

        return dial;
      }

      function addDialNumber(dial, angle, r, value, inner) {
        const p = polar(CENTER, CENTER, r, angle);
        const el = document.createElement('div');
        el.className = 'picker-dial-number' + (inner ? ' inner' : '');
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        el.textContent = String(value);
        dial.appendChild(el);
      }

      function iconBtn(label) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'picker-icon-btn';
        b.textContent = label;
        return b;
      }
      function iconBtnPlaceholder() {
        const b = iconBtn('');
        b.style.visibility = 'hidden';
        b.disabled = true;
        return b;
      }
      function textBtn(label, onClick, primary) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'picker-text-btn' + (primary ? ' primary' : '');
        b.textContent = label;
        b.addEventListener('click', onClick);
        return b;
      }

      render();
    });
  }

  return { pick };
})();
