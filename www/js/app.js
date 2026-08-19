(() => {
  'use strict';

  // ---------- DOM references ----------
  const el = (id) => document.getElementById(id);
  const topbar = el('topbar');
  const topbarTitle = el('topbarTitle');
  const closeEditorBtn = el('closeEditorBtn');
  const clearAllBtn = el('clearAllBtn');

  const listView = el('listView');
  const cardsContainer = el('cardsContainer');
  const newNoteBtn = el('newNoteBtn');

  const editorView = el('editorView');
  const editorCard = el('editorCard');
  const editorTextarea = el('editorTextarea');
  const reminderBtn = el('reminderBtn');
  const sendBtn = el('sendBtn');

  const shoppingView = el('shoppingView');
  const shoppingTextarea = el('shoppingTextarea');

  const undoSnackbar = el('undoSnackbar');
  const undoBtn = el('undoBtn');
  const undoRingProgress = el('undoRingProgress');

  const toast = el('toast');

  const navBtns = Array.from(document.querySelectorAll('.nav-btn'));
  const badgeUrgent = el('badgeUrgent');
  const badgePlans = el('badgePlans');
  const badgeBuy = el('badgeBuy');
  const badgeThings = el('badgeThings');

  const NOTE_TABS = ['urgent', 'plans', 'buy'];
  const TAB_LABELS = { urgent: 'Срочно', plans: 'Планы', buy: 'Купить', things: 'Блокнот' };

  // ---------- App state ----------
  const state = {
    tab: 'urgent',            // 'urgent' | 'plans' | 'buy' | 'things'
    mode: 'list',             // 'list' | 'editor' | 'composer'  (ignored for the shopping/notebook tab)
    notesCache: { urgent: [], plans: [], buy: [] },
    currentNote: null,        // note being edited/composed — same object for both modes
    shoppingSaveTimer: null,
    justCreatedId: null,      // note id to play the "enter" animation for, once
  };

  // ---------- Init ----------
  // Каждый шаг обёрнут в try/catch, чтобы сбой одного из них
  // (IndexedDB заблокирована, хранилище переполнено и т.д.)
  // не оставлял пользователя с чёрным экраном.
  async function init() {
    // persist() может зависнуть в некоторых WebView — форсируем таймаут 2 с
    try { await Promise.race([DB.requestPersistence(), new Promise((r) => setTimeout(r, 2000))]); } catch (e) { /* не фатально */ }

    try { await migrateOldGroceriesField(); } catch (e) { /* не фатально */ }

    try { await loadNotes('urgent'); } catch (e) { /* кеш останется пустым, UI отобразится */ }
    try { await loadNotes('plans'); } catch (e) {}
    try { await loadNotes('buy'); } catch (e) {}

    try { Reminders.rearm([...state.notesCache.urgent, ...state.notesCache.plans, ...state.notesCache.buy]); } catch (e) {}
    // ensureAlarmSetup() (запрос точных будильников/full-screen intent/игнора
    // батарейной оптимизации) НЕ вызывается тут: системные диалоги не должны
    // всплывать при каждом холодном старте. Вызывается один раз — при первом
    // реальном сохранении напоминания пользователем, см. ensureAlarmSetupOnce()
    // и его вызов в обработчике reminderBtn ниже.

    try { await updateShoppingBadge(); } catch (e) {}

    try { render(); } catch (e) {}

    registerServiceWorker();
    setupViewportAdaptation();

    // Всегда показываем интерфейс, даже если часть данных не загрузилась
    requestAnimationFrame(() => document.body.classList.add('ready'));
  }

  // One-time migration: the old "Купить продукты" tab used to be a single
  // accumulating text field (stored in the shopping store under id
  // 'groceries'). It is now a full note-card tab ('buy'). If that old field
  // still has text and the new tab has no notes yet, turn it into a single
  // note so nothing is silently lost, then clear the old field.
  async function migrateOldGroceriesField() {
    try {
      const oldText = await DB.getShopping('groceries');
      if (!oldText || !oldText.trim()) return;
      const existing = await DB.getAllNotes('buy');
      if (existing.length === 0) {
        await DB.putNote({
          id: DB.newId(), tab: 'buy', text: oldText, order: Date.now(),
          createdAt: Date.now(), updatedAt: Date.now(), reminderAt: null,
        });
      }
      await DB.setShopping('groceries', '');
    } catch (e) { /* best effort, never block startup */ }
  }

  async function loadNotes(tab) {
    state.notesCache[tab] = await DB.getAllNotes(tab);
  }

  // ---------- Rendering ----------
  function render() {
    navBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === state.tab);
    });

    const isNoteTab = NOTE_TABS.includes(state.tab);
    const editorOpen = isNoteTab && state.mode === 'editor';
    const composerOpen = isNoteTab && state.mode === 'composer';
    const shoppingOpen = !isNoteTab;

    listView.classList.toggle('hidden', !(isNoteTab && state.mode === 'list'));
    editorView.classList.toggle('hidden', !(editorOpen || composerOpen));
    shoppingView.classList.toggle('hidden', isNoteTab);

    // The top bar (title + "Очистить") is shown whenever a text field is
    // open on screen: the fullscreen note editor/composer, OR either of
    // the always-open shopping fields. The back arrow only makes sense
    // for the note editor/composer (shopping tabs have nowhere to "go
    // back" to — they're already a main tab).
    topbar.classList.toggle('hidden', !(editorOpen || composerOpen || shoppingOpen));
    closeEditorBtn.style.visibility = (editorOpen || composerOpen) ? 'visible' : 'hidden';
    topbarTitle.textContent = (editorOpen || composerOpen || shoppingOpen) ? TAB_LABELS[state.tab] : '';

    newNoteBtn.style.display = (isNoteTab && state.mode === 'list') ? '' : 'none';

    if (isNoteTab && state.mode === 'list') renderCards();
    if (editorOpen || composerOpen) {
      reminderBtn.classList.toggle('set', !!(state.currentNote && state.currentNote.reminderAt));
      reminderBtn.textContent = reminderLabel(state.currentNote);
    }
    updateNoteBadges();
  }

  function updateNoteBadges() {
    badgeUrgent.textContent = String(state.notesCache.urgent.length);
    badgePlans.textContent = String(state.notesCache.plans.length);
    badgeBuy.textContent = String(state.notesCache.buy.length);
  }

  async function updateShoppingBadge() {
    // Only the "Блокнот" (things) tab is still a single accumulating field.
    const text = await DB.getShopping('things');
    badgeThings.classList.toggle('hidden', !text || !text.trim());
  }

  function reminderLabel(note) {
    if (note && note.reminderAt) return 'Уведомление ' + formatDateTime(note.reminderAt);
    return 'Установить срок';
  }

  function formatDateTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderCards() {
    const notes = state.notesCache[state.tab];
    cardsContainer.innerHTML = '';
    notes.forEach((note) => cardsContainer.appendChild(buildCard(note)));
  }

  // Свайп влево на плашке (не свайп на самой ручке-хендле — та занята
  // drag-to-reorder) открывает корзину, спрятанную за правым краем.
  // Одновременно открыта только одна плашка — открытие новой закрывает
  // предыдущую. Ширина зоны корзины должна совпадать с CSS
  // (.note-card-delete-reveal width).
  const SWIPE_DELETE_WIDTH = 76;
  let openSwipeCard = null; // DOM-элемент .note-card-swipe текущей открытой плашки, либо null

  function closeOpenSwipe() {
    if (openSwipeCard) {
      openSwipeCard.style.transform = '';
      openSwipeCard = null;
    }
  }

  document.addEventListener('click', (e) => {
    if (openSwipeCard && !openSwipeCard.contains(e.target)) closeOpenSwipe();
  });

  function buildCard(note) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.id = note.id;
    if (note.id === state.justCreatedId) {
      card.classList.add('note-card-enter');
      state.justCreatedId = null; // one-shot
    }

    // Корзина лежит НИЖЕ свайп-слоя (в DOM раньше него), поэтому пока
    // .note-card-swipe не сдвинут — она полностью им закрыта.
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'note-card-delete-reveal';
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('aria-label', 'Удалить');
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNoteWithUndo(note.id);
    });
    card.appendChild(deleteBtn);

    const swipe = document.createElement('div');
    swipe.className = 'note-card-swipe';

    // Preview text is independently scrollable (swipe up/down) before the
    // card is opened; a slim custom thumb tracks the scroll position.
    // The track lives OUTSIDE the scrollable text container (as a sibling
    // inside .note-card-swipe) so its position is never affected by scrolling.
    const textOuter = document.createElement('div');
    textOuter.className = 'note-card-text';
    const textInner = document.createElement('div');
    textInner.className = 'note-card-text-inner';
    textInner.textContent = note.text || '';
    textOuter.appendChild(textInner);
    swipe.appendChild(textOuter);

    const track = document.createElement('div');
    track.className = 'note-scroll-track';
    const thumb = document.createElement('div');
    thumb.className = 'note-scroll-thumb';
    track.appendChild(thumb);
    swipe.appendChild(track);
    attachScrollThumb(swipe, textOuter, thumb);

    const meta = document.createElement('div');
    meta.className = 'note-card-meta';
    meta.innerHTML = `<span class="note-card-date">${formatDateTime(note.createdAt)}</span>`;
    if (note.reminderAt) {
      const chip = document.createElement('span');
      chip.className = 'reminder-chip';
      chip.textContent = 'Уведомление ' + formatDateTime(note.reminderAt);
      meta.appendChild(chip);
    }
    swipe.appendChild(meta);

    const handle = document.createElement('button');
    handle.className = 'note-card-handle';
    handle.type = 'button';
    handle.setAttribute('aria-label', 'Перетащить');
    handle.innerHTML = '<svg viewBox="0 0 20 36" width="16" height="30"><circle cx="6" cy="3" r="1.4" fill="currentColor"/><circle cx="14" cy="3" r="1.4" fill="currentColor"/><circle cx="6" cy="9" r="1.4" fill="currentColor"/><circle cx="14" cy="9" r="1.4" fill="currentColor"/><circle cx="6" cy="15" r="1.4" fill="currentColor"/><circle cx="14" cy="15" r="1.4" fill="currentColor"/><circle cx="6" cy="21" r="1.4" fill="currentColor"/><circle cx="14" cy="21" r="1.4" fill="currentColor"/><circle cx="6" cy="27" r="1.4" fill="currentColor"/><circle cx="14" cy="27" r="1.4" fill="currentColor"/><circle cx="6" cy="33" r="1.4" fill="currentColor"/><circle cx="14" cy="33" r="1.4" fill="currentColor"/></svg>';
    swipe.appendChild(handle);

    card.appendChild(swipe);

    swipe.addEventListener('click', () => {
      if (card.dataset.wasDrag === '1' || card.dataset.wasSwipe === '1') return;
      if (openSwipeCard === swipe) { closeOpenSwipe(); return; }
      openEditor(note);
    });

    attachDrag(card, handle);
    attachSwipe(card, swipe);
    return card;
  }

	  // ---------- Slim custom scrollbar thumb for overflowing card previews ----------
	  // Visual indicator only (pointer-events:none via CSS). The track lives
	  // outside the scrollable text container so it never moves with content.
	  // The thumb shrinks proportionally as hidden content grows, and moves
	  // in the standard direction: scrolling down moves the thumb down.
	  function attachScrollThumb(card, outer, thumb) {
	    const track = thumb.parentElement;
	    let ticking = false;

	    function update() {
	      // Anchor the track to the text area's position within the card.
	      const textRect = outer.getBoundingClientRect();
	      const cardRect = card.getBoundingClientRect();
	      const trackHeight = textRect.height;
	      track.style.top = (textRect.top - cardRect.top) + 'px';
	      track.style.height = trackHeight + 'px';

	      const contentHeight = outer.scrollHeight;

	      // Show the thumb only when the preview text overflows (7+ lines).
	      if (contentHeight <= trackHeight + 1) {
	        thumb.style.display = 'none';
	        return;
	      }
	      thumb.style.display = 'block';

	      // Thumb height proportional to visible / total, min 6 px.
	      const thumbH = Math.max(6, Math.round((trackHeight / contentHeight) * trackHeight));

	      // Scroll progress: 0 = first line visible, 1 = last line visible.
	      const maxScroll = contentHeight - outer.clientHeight;
	      const progress = maxScroll > 0 ? outer.scrollTop / maxScroll : 0;

	      // Thumb travel range inside the track.
	      const maxTravel = trackHeight - thumbH;
	      const thumbTop = Math.round(progress * maxTravel);

	      thumb.style.height = thumbH + 'px';
	      thumb.style.transform = 'translateY(' + thumbTop + 'px)';
	    }

	    // rAF throttle: collect rapid scroll events, update once per frame.
	    outer.addEventListener('scroll', () => {
	      if (!ticking) {
	        requestAnimationFrame(() => { update(); ticking = false; });
	        ticking = true;
	      }
	    }, { passive: true });

	    const ro = new ResizeObserver(() => update());
	    ro.observe(outer);

	    // Double rAF so the initial measurement happens after layout is settled.
	    requestAnimationFrame(() => requestAnimationFrame(update));

	    return update;
	  }

  // ---------- Swipe-to-delete gesture ----------
  // Started on .note-card-swipe (not on the drag handle -- that one already
  // stops propagation for its own pointerdown, see attachDrag). CSS gives
  // this element touch-action:none, so the browser never starts a native
  // scroll of its own accord -- everything (horizontal reveal AND, when the
  // gesture turns out vertical, the list/preview scroll) is driven here.
  // That removes the previous race against Android WebView's compositor,
  // which could start a native scroll before this handler's preventDefault()
  // ran on a busy main thread, cancelling/reverting the horizontal swipe.
  function attachSwipe(card, swipe) {
    const textEl = swipe.querySelector('.note-card-text');
    let tracking = false;
    let decided = null; // null | 'horizontal' | 'vertical'
    let startX = 0, startY = 0, baseX = 0, lastX = 0;
    let startTarget = null;
    let vTarget = null;   // element being manually scrolled this gesture
    let vStartTop = 0;
    let lastY = 0, lastT = 0, vVelocity = 0; // for a light momentum tail

    swipe.addEventListener('pointerdown', (e) => {
      tracking = true;
      decided = null;
      startX = e.clientX;
      startY = e.clientY;
      lastY = e.clientY;
      lastT = e.timeStamp;
      vVelocity = 0;
      startTarget = e.target;
      baseX = openSwipeCard === swipe ? -SWIPE_DELETE_WIDTH : 0;
      lastX = baseX;
      swipe.style.transition = 'none'; // instant tracking while the finger is down
      // Captured immediately (not only once decided) since touch-action:none
      // means nothing native will ever claim this gesture -- capturing early
      // just guarantees we keep getting every move even if the finger
      // strays outside the row bounds.
      try { swipe.setPointerCapture(e.pointerId); } catch (err) {}
    });

    swipe.addEventListener('pointermove', (e) => {
      if (!tracking) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!decided) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        decided = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
        if (decided === 'horizontal') {
          if (openSwipeCard && openSwipeCard !== swipe) closeOpenSwipe();
        } else {
          // Scroll the inner text preview if the gesture started over it and
          // it still has its own overflow to scroll; otherwise scroll the
          // card list itself -- mirrors the nested-scroll resolution the
          // browser used to do natively.
          vTarget = (textEl && textEl.contains(startTarget) && textEl.scrollHeight > textEl.clientHeight)
            ? textEl : listView;
          vStartTop = vTarget.scrollTop;
        }
      }
      e.preventDefault();
      if (decided === 'horizontal') {
        lastX = Math.max(-SWIPE_DELETE_WIDTH, Math.min(0, baseX + dx));
        swipe.style.transform = `translateX(${lastX}px)`;
      } else if (vTarget) {
        vTarget.scrollTop = vStartTop - dy;
        const dt = e.timeStamp - lastT;
        if (dt > 0) vVelocity = (e.clientY - lastY) / dt; // px per ms
        lastY = e.clientY;
        lastT = e.timeStamp;
      }
    });

    function endDrag(e) {
      if (!tracking) return;
      tracking = false;
      try { swipe.releasePointerCapture(e.pointerId); } catch (err) {}
      if (decided === 'vertical') {
        flingScroll(vTarget, vVelocity);
        vTarget = null;
        decided = null;
        return;
      }
      if (decided !== 'horizontal') { decided = null; return; }
      swipe.style.transition = 'transform .18s ease';
      // Lower than a strict half-width so a short-but-clearly-horizontal
      // drag still commits to open rather than snapping shut.
      if (lastX < -SWIPE_DELETE_WIDTH * 0.35) {
        swipe.style.transform = `translateX(${-SWIPE_DELETE_WIDTH}px)`;
        openSwipeCard = swipe;
      } else {
        swipe.style.transform = '';
        if (openSwipeCard === swipe) openSwipeCard = null;
      }
      card.dataset.wasSwipe = '1';
      decided = null;
      setTimeout(() => { card.dataset.wasSwipe = '0'; }, 50);
    }
    swipe.addEventListener('pointerup', endDrag);
    swipe.addEventListener('pointercancel', endDrag);
  }

  // Small inertia tail for the manually-driven vertical scroll above (native
  // fling no longer applies once touch-action is 'none') -- decelerates a
  // scrollTop-based scroll using the release velocity (px/ms). scrollTop
  // assignment is auto-clamped by the browser, so no manual bounds needed.
  function flingScroll(el, velocity) {
    if (!el || Math.abs(velocity) < 0.02) return;
    let v = velocity * 16; // px per ~frame
    function step() {
      v *= 0.94;
      el.scrollTop -= v;
      if (Math.abs(v) > 0.5) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---------- Delete with undo ----------
  // The note is removed from DB immediately (its reminder cancelled), but a
  // snackbar with a 5s shrinking ring offers to restore it — see undoBtn
  // handler below.
  let undoState = null; // { note, tab, timer } | null
  const UNDO_MS = 5000;

  async function deleteNoteWithUndo(id) {
    const notes = state.notesCache[state.tab];
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    closeOpenSwipe();

    const cardEl = cardsContainer.querySelector(`[data-id="${id}"]`);
    if (cardEl) {
      cardEl.classList.add('note-card-exit');
      await new Promise((r) => setTimeout(r, 180));
    }

    Reminders.cancel(id);
    await DB.deleteNote(id);
    await loadNotes(state.tab);
    render();
    showUndoSnackbar(note, state.tab);
  }

  function showUndoSnackbar(note, tab) {
    if (undoState) clearTimeout(undoState.timer);
    undoState = { note, tab, timer: null };
    undoSnackbar.classList.remove('hidden');

    // CSS keyframe animation (not a JS-driven transition) so it isn't at the
    // mercy of requestAnimationFrame throttling; restarted via the classic
    // remove-class -> force reflow -> re-add-class trick.
    undoRingProgress.classList.remove('counting');
    void undoRingProgress.getBoundingClientRect(); // force reflow to restart the animation
    undoRingProgress.classList.add('counting');

    undoState.timer = setTimeout(() => {
      undoSnackbar.classList.add('hidden');
      undoState = null;
    }, UNDO_MS);
  }

  undoBtn.addEventListener('click', async () => {
    if (!undoState) return;
    clearTimeout(undoState.timer);
    const { note, tab } = undoState;
    undoState = null;
    undoSnackbar.classList.add('hidden');
    await DB.putNote(note);
    await loadNotes(tab);
    if (tab === state.tab) render(); else updateNoteBadges();
  });

  // ---------- Opening a note: composer (new) or editor (existing) ----------
  // Both paths converge on the same `state.currentNote` + the same
  // autosave/close logic, so typed text is never lost regardless of how
  // the person leaves the screen (Отправить, Назад, system back, tab switch).

  function openComposer() {
    const startRect = newNoteBtn.getBoundingClientRect();

    const existingNotes = state.notesCache[state.tab] || [];
    const topOrder = existingNotes.length ? Math.min(...existingNotes.map((n) => n.order)) - 1 : Date.now();

    state.currentNote = {
      id: DB.newId(), tab: state.tab, text: '', order: topOrder,
      createdAt: Date.now(), updatedAt: Date.now(), reminderAt: null,
    };
    state.mode = 'composer';
    editorTextarea.value = '';
    editorTextarea.readOnly = false;
    history.pushState({ subview: 'composer' }, '');
    render();
    playGrowAnimation(startRect);
    editorTextarea.focus(); // keyboard opens immediately for a brand-new note
  }

  function playGrowAnimation(startRect) {
    const endRect = editorCard.getBoundingClientRect();
    const dx = startRect.left - endRect.left;
    const dy = startRect.top - endRect.top;
    const sx = startRect.width / endRect.width;
    const sy = startRect.height / endRect.height;
    editorCard.style.transition = 'none';
    editorCard.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    editorCard.getBoundingClientRect(); // force reflow
    editorCard.classList.add('growing');
    requestAnimationFrame(() => { editorCard.style.transform = 'none'; });
    editorCard.addEventListener('transitionend', function cleanup() {
      editorCard.classList.remove('growing');
      editorCard.style.transition = '';
      editorCard.removeEventListener('transitionend', cleanup);
    });
  }

  function openEditor(note) {
    state.currentNote = note;
    state.mode = 'editor';
    editorCard.style.transform = '';
    editorCard.classList.remove('growing');
    editorTextarea.value = note.text || '';
    editorTextarea.readOnly = true; // first tap only opens the card, no keyboard yet
    history.pushState({ subview: 'editor' }, '');
    render();
  }

  editorTextarea.addEventListener('click', () => {
    if (editorTextarea.readOnly) {
      editorTextarea.readOnly = false;
      editorTextarea.focus(); // second tap opens the keyboard
    }
  });

  let editorSaveTimer = null;
  editorTextarea.addEventListener('input', () => {
    if (!state.currentNote) return;
    clearTimeout(editorSaveTimer);
    editorSaveTimer = setTimeout(saveCurrentNote, 350);
  });

  async function saveCurrentNote() {
    if (!state.currentNote) return;
    state.currentNote.text = editorTextarea.value;
    state.currentNote.updatedAt = Date.now();
    await DB.putNote(state.currentNote);
    await loadNotes(state.tab);
  }

  // Единая точка выхода из редактора/композера: сохраняет текст, удаляет
  // заметку если она осталась пустой, возвращает на список плашек.
  // Используется и кнопкой "Назад", и кнопкой "Отправить", и системным back.
  async function closeAndReturnToList() {
    clearTimeout(editorSaveTimer);
    if (state.currentNote) {
      const wasComposer = state.mode === 'composer';
      await saveCurrentNote();
      if (!editorTextarea.value.trim()) {
        Reminders.cancel(state.currentNote.id);
        await DB.deleteNote(state.currentNote.id);
        await loadNotes(state.tab);
      } else if (wasComposer) {
        state.justCreatedId = state.currentNote.id;
      }
    }
    editorCard.style.transform = '';
    editorCard.classList.remove('growing');
    state.mode = 'list';
    state.currentNote = null;
    render();
  }

  newNoteBtn.addEventListener('click', openComposer);

  // "Отправить" ведёт себя как "Назад": сохраняет и закрывает — работает
  // одинаково что для новой заметки, что для уже открытой старой.
  sendBtn.addEventListener('click', () => history.back());
  closeEditorBtn.addEventListener('click', () => {
    if (state.mode === 'editor' || state.mode === 'composer') history.back();
  });

  // Слоистая история: у пикера даты/времени (см. datetime-picker.js) своя
  // запись поверх редактора. Когда "назад" всплывает сюда и мы приземлились
  // ИМЕННО на слое редактора — значит, слой НАД ним (пикер) только что сам
  // себя закрыл через свой собственный popstate-листенер; редактор трогать
  // не нужно. Закрываем редактор только когда посадка происходит "в корень"
  // (никакого известного слоя над ним больше нет).
  window.addEventListener('popstate', (e) => {
    const landedOnSubview = e.state && e.state.subview;
    if (landedOnSubview === 'editor' || landedOnSubview === 'composer') return;
    if (state.mode === 'editor' || state.mode === 'composer') {
      closeAndReturnToList();
    }
  });

  // ---------- Clear-all ("Очистить" in the top bar) ----------
  // Works both for the note editor/composer AND for the shopping tabs.
  // Same inline-confirm pattern as the trash icon: no system dialog. First
  // tap turns the button itself into a red "Удалить текст?" prompt; a
  // second tap on it confirms, a tap anywhere else cancels.
  const clearBtnDefaultHTML = clearAllBtn.innerHTML;
  let clearConfirming = false;

  function enterClearConfirm() {
    clearConfirming = true;
    clearAllBtn.classList.add('confirming');
    clearAllBtn.innerHTML = '<span>Удалить текст?</span>';
  }
  function exitClearConfirm() {
    clearConfirming = false;
    clearAllBtn.classList.remove('confirming');
    clearAllBtn.innerHTML = clearBtnDefaultHTML;
  }

  clearAllBtn.addEventListener('click', () => {
    if (!clearConfirming) {
      enterClearConfirm();
      return;
    }
    const isNoteTab = NOTE_TABS.includes(state.tab);
    if (isNoteTab) {
      editorTextarea.value = '';
      editorTextarea.focus();
      if (state.currentNote) {
        state.currentNote.text = '';
        DB.putNote(state.currentNote);
      }
    } else {
      shoppingTextarea.value = '';
      shoppingTextarea.focus();
      DB.setShopping(state.tab, '');
      updateShoppingBadge();
    }
    exitClearConfirm();
  });
  document.addEventListener('click', (e) => {
    if (clearConfirming && !clearAllBtn.contains(e.target)) exitClearConfirm();
  });

  // ---------- Toast Helper ----------
  let toastTimer = null;
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.classList.add('hidden'), 250);
    }, 3500);
  }

  // ---------- Reminder modal ----------
  // Системные диалоги (точные будильники / full-screen intent / игнор
  // батарейной оптимизации) запрашиваются один раз — при первом реальном
  // сохранении напоминания, а не на каждом холодном старте приложения.
  const ALARM_SETUP_DONE_KEY = 'mynotes_alarm_setup_done';
  async function ensureAlarmSetupOnce() {
    try {
      if (localStorage.getItem(ALARM_SETUP_DONE_KEY) === '1') return;
      await Reminders.ensureAlarmSetup();
      localStorage.setItem(ALARM_SETUP_DONE_KEY, '1');
    } catch (e) {}
  }

  // Открывает кастомный пикер (календарь -> циферблат) напрямую по тапу —
  // без промежуточного экрана; результат: timestamp | 'clear' | null.
  reminderBtn.addEventListener('click', async () => {
    if (!state.currentNote) return;
    const initial = state.currentNote.reminderAt || (Date.now() + 30 * 60000);
    const result = await DateTimePicker.pick(initial, { canClear: !!state.currentNote.reminderAt });
    if (result === null || !state.currentNote) return;

    if (result === 'clear') {
      const id = state.currentNote.id;
      state.currentNote.reminderAt = null;
      reminderBtn.classList.remove('set');
      reminderBtn.textContent = reminderLabel(state.currentNote);
      try {
        Reminders.cancel(id);
        await DB.putNote(state.currentNote);
        await loadNotes(state.tab);
        renderCards();
        updateNoteBadges();
      } catch (e) {}
      return;
    }

    const ts = result;
    const prevReminderAt = state.currentNote.reminderAt;
    state.currentNote.reminderAt = ts;

    // Оптимистично обновляем кнопку в редакторе
    reminderBtn.classList.add('set');
    reminderBtn.textContent = reminderLabel(state.currentNote);

    // Сохраняем в локальную БД
    try {
      await DB.putNote(state.currentNote);
      await loadNotes(state.tab);
      renderCards();
      updateNoteBadges();
    } catch (e) {}

    // Фоново вызываем нативный будильник
    await ensureAlarmSetupOnce();
    const preview = (state.currentNote.text || '').split('\n')[0].slice(0, 60) || 'Заметка';
    try {
      await Reminders.schedule(state.currentNote.id, ts, 'Будильник', preview);
    } catch (err) {
      console.error('Ошибка планирования будильника:', err);
      // Откат оптимистичного состояния при ошибке
      state.currentNote.reminderAt = prevReminderAt;
      await DB.putNote(state.currentNote);
      await loadNotes(state.tab);
      reminderBtn.classList.toggle('set', !!(state.currentNote && state.currentNote.reminderAt));
      reminderBtn.textContent = reminderLabel(state.currentNote);
      reminderBtn.classList.add('error');
      setTimeout(() => reminderBtn.classList.remove('error'), 800);
      renderCards();
      updateNoteBadges();
      showToast(err.message || 'Не удалось включить будильник: нет разрешения');
    }
  });

  // ---------- Shopping tabs (accumulating autosave field) ----------
  async function showShopping(tab) {
    shoppingTextarea.value = await DB.getShopping(tab);
    await updateShoppingBadge();
  }
  shoppingTextarea.addEventListener('input', () => {
    clearTimeout(state.shoppingSaveTimer);
    state.shoppingSaveTimer = setTimeout(() => {
      DB.setShopping(state.tab, shoppingTextarea.value);
      updateShoppingBadge();
    }, 300);
  });

  // ---------- Bottom nav ----------
  navBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (state.mode !== 'list') await closeAndReturnToList();
      state.tab = btn.dataset.tab;
      if (state.tab === 'things') {
        await showShopping(state.tab);
      }
      render();
    });
  });

  // ---------- Drag-to-reorder ----------
  // The gesture starts ONLY on the dedicated handle icon (touch-action:none
  // there prevents the browser from treating it as a page scroll). Long-press
  // anywhere else on the card body keeps the normal native text-selection
  // behaviour instead of dragging.
  // The dragged card is switched to position:fixed and follows the pointer
  // directly (top = initialTop + totalPointerDelta) — never a value derived
  // from the previous frame — so nothing can accumulate/drift and the card
  // can never "fly off" the screen. A thin placeholder line is inserted
  // into the real flex flow to show exactly where the card will land, and
  // that placeholder (not the dragged card) is what moves between
  // siblings, so the rest of the list never jumps or overlaps.
  function attachDrag(card, handle) {
    let dragging = false;
    let startY = 0;
    let initialTop = 0;
    let initialLeft = 0;
    let cardWidth = 0;
    let cardHeight = 0;
    let placeholder = null;
    let scrollEl = null;

    function otherCards() {
      return Array.from(cardsContainer.children).filter((c) => c !== card && c !== placeholder);
    }

    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      dragging = true;
      card.dataset.wasDrag = '1';

      scrollEl = listView; // .list-view is the scrollable ancestor
      const rect = card.getBoundingClientRect();
      initialTop = rect.top;
      initialLeft = rect.left;
      cardWidth = rect.width;
      cardHeight = rect.height;
      startY = e.clientY;

      placeholder = document.createElement('div');
      placeholder.className = 'note-card-placeholder';
      cardsContainer.insertBefore(placeholder, card);

      card.classList.add('dragging');
      card.style.position = 'fixed';
      card.style.top = initialTop + 'px';
      card.style.left = initialLeft + 'px';
      card.style.width = cardWidth + 'px';
      card.style.margin = '0';
      card.style.zIndex = '50';
      document.body.appendChild(card);

      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      const newTop = initialTop + dy;
      card.style.top = newTop + 'px';

      const cardMidY = newTop + cardHeight / 2;
      const siblings = otherCards();
      let target = null;
      for (const sib of siblings) {
        const r = sib.getBoundingClientRect();
        if (cardMidY < r.top + r.height / 2) { target = sib; break; }
      }
      if (target) {
        if (placeholder.nextSibling !== target) cardsContainer.insertBefore(placeholder, target);
      } else if (cardsContainer.lastElementChild !== placeholder) {
        cardsContainer.appendChild(placeholder);
      }

      // Auto-scroll the list when dragging near its top/bottom edge.
      if (scrollEl) {
        const svRect = scrollEl.getBoundingClientRect();
        const edge = 48;
        if (e.clientY < svRect.top + edge) scrollEl.scrollTop -= 12;
        else if (e.clientY > svRect.bottom - edge) scrollEl.scrollTop += 12;
      }
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      card.classList.remove('dragging');
      card.style.position = '';
      card.style.top = '';
      card.style.left = '';
      card.style.width = '';
      card.style.margin = '';
      card.style.zIndex = '';
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}

      if (placeholder && placeholder.parentNode) {
        cardsContainer.insertBefore(card, placeholder);
        placeholder.remove();
      } else {
        cardsContainer.appendChild(card);
      }
      placeholder = null;

      const ids = Array.from(cardsContainer.children).map((c) => c.dataset.id);
      const notes = state.notesCache[state.tab];
      ids.forEach((id, idx) => {
        const n = notes.find((x) => x.id === id);
        if (n) { n.order = idx; DB.putNote(n); }
      });
      notes.sort((a, b) => a.order - b.order);
      setTimeout(() => { card.dataset.wasDrag = '0'; }, 50);
    }

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  // ---------- Keyboard-aware viewport height ----------
  // Fallback for browsers that don't honour interactive-widget=resizes-content:
  // track the visualViewport height so the app shrinks above the keyboard
  // instead of being covered by it.
  function setupViewportAdaptation() {
    if (!window.visualViewport) return;
    const apply = () => {
      document.documentElement.style.setProperty('--app-height', window.visualViewport.height + 'px');
    };
    apply();
    window.visualViewport.addEventListener('resize', apply);
  }

  // ---------- Service worker ----------
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init().catch(() => {
    // Последний рубеж: если init() всё же упал — показываем интерфейс
    try { render(); } catch (e) {}
    requestAnimationFrame(() => document.body.classList.add('ready'));
  });
})();
