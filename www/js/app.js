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

  const confirmPopover = el('confirmPopover');
  const confirmYes = el('confirmYes');

  const reminderModal = el('reminderModal');
  const reminderInput = el('reminderInput');
  const reminderSave = el('reminderSave');
  const reminderClear = el('reminderClear');
  const reminderCancel = el('reminderCancel');
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
    pendingDeleteId: null,
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
    try { Reminders.ensureAlarmSetup(); } catch (e) {}

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

  function buildCard(note) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.id = note.id;
    if (note.id === state.justCreatedId) {
      card.classList.add('note-card-enter');
      state.justCreatedId = null; // one-shot
    }

    // Preview text is independently scrollable (swipe up/down) before the
    // card is opened; a slim custom thumb tracks the scroll position.
    // The track lives OUTSIDE the scrollable text container (as a sibling
    // inside .note-card) so its position is never affected by scrolling.
    const textOuter = document.createElement('div');
    textOuter.className = 'note-card-text';
    const textInner = document.createElement('div');
    textInner.className = 'note-card-text-inner';
    textInner.textContent = note.text || '';
    textOuter.appendChild(textInner);
    card.appendChild(textOuter);

    const track = document.createElement('div');
    track.className = 'note-scroll-track';
    const thumb = document.createElement('div');
    thumb.className = 'note-scroll-thumb';
    track.appendChild(thumb);
    card.appendChild(track);
    attachScrollThumb(card, textOuter, thumb);

    const meta = document.createElement('div');
    meta.className = 'note-card-meta';
    meta.innerHTML = `<span>${formatDateTime(note.createdAt)}</span>`;
    if (note.reminderAt) {
      const chip = document.createElement('span');
      chip.className = 'reminder-chip';
      chip.textContent = 'Уведомление ' + formatDateTime(note.reminderAt);
      meta.appendChild(chip);
    }
    card.appendChild(meta);

    const controls = document.createElement('div');
    controls.className = 'note-card-controls';

    const trash = document.createElement('button');
    trash.className = 'note-card-trash';
    trash.type = 'button';
    trash.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    trash.addEventListener('click', (e) => {
      e.stopPropagation();
      showDeleteConfirm(trash, note.id);
    });
    controls.appendChild(trash);

    const handle = document.createElement('button');
    handle.className = 'note-card-handle';
    handle.type = 'button';
    handle.setAttribute('aria-label', 'Перетащить');
    handle.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/></svg>';
    controls.appendChild(handle);

    card.appendChild(controls);

    card.addEventListener('click', () => {
      if (card.dataset.wasDrag === '1') return;
      openEditor(note);
    });

    attachDrag(card, handle);
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

  // ---------- Delete confirm popover (appears over the trash icon; tap
  // outside cancels — no separate "Нет" button) ----------
  function showDeleteConfirm(anchorEl, noteId) {
    state.pendingDeleteId = noteId;
    const rect = anchorEl.getBoundingClientRect();
    confirmPopover.style.top = `${rect.top - 6}px`;
    confirmPopover.style.left = `${Math.max(8, rect.right - 120)}px`;
    confirmPopover.classList.remove('hidden');
  }
  function hideDeleteConfirm() {
    confirmPopover.classList.add('hidden');
    state.pendingDeleteId = null;
  }
  confirmYes.addEventListener('click', async () => {
    if (!state.pendingDeleteId) return;
    const id = state.pendingDeleteId;
    Reminders.cancel(id);
    await DB.deleteNote(id);
    await loadNotes(state.tab);
    hideDeleteConfirm();
    render();
  });
  document.addEventListener('click', (e) => {
    if (!confirmPopover.classList.contains('hidden') && !confirmPopover.contains(e.target)) {
      hideDeleteConfirm();
    }
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

  window.addEventListener('popstate', () => {
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
  reminderBtn.addEventListener('click', () => {
    if (!state.currentNote) return;
    const d = state.currentNote.reminderAt ? new Date(state.currentNote.reminderAt) : new Date(Date.now() + 30 * 60000);
    reminderInput.value = toLocalInputValue(d);
    reminderModal.classList.remove('hidden');
  });
  reminderCancel.addEventListener('click', () => reminderModal.classList.add('hidden'));
  reminderModal.addEventListener('click', (e) => { if (e.target === reminderModal) reminderModal.classList.add('hidden'); });

  reminderClear.addEventListener('click', async () => {
    reminderModal.classList.add('hidden');
    if (state.currentNote) {
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
    }
  });

  reminderSave.addEventListener('click', async () => {
    if (!state.currentNote || !reminderInput.value) {
      reminderModal.classList.add('hidden');
      return;
    }
    const ts = new Date(reminderInput.value).getTime();
    if (isNaN(ts)) {
      reminderModal.classList.add('hidden');
      return;
    }

    // 1. Мгновенно закрываем модальное окно
    reminderModal.classList.add('hidden');

    const prevReminderAt = state.currentNote.reminderAt;
    state.currentNote.reminderAt = ts;

    // 2. Оптимистично обновляем кнопку в редакторе
    reminderBtn.classList.add('set');
    reminderBtn.textContent = reminderLabel(state.currentNote);

    // 3. Сохраняем в локальную БД
    try {
      await DB.putNote(state.currentNote);
      await loadNotes(state.tab);
      renderCards();
      updateNoteBadges();
    } catch (e) {}

    // 4. Фоново вызываем нативный будильник
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

  function toLocalInputValue(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

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
