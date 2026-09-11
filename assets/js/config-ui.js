/* ===================================================================
   STEAM Teams CC — Settings renderer
   /assets/js/config-ui.js

   W11.4, workstream 02_ Coordinator Dashboard. Architecture Ruling
   2026-09-11 (definition vs operating), Level 2.

   Renders portal_config rows ENTIRELY from their own metadata:
   label, description, value_type, group_name, edit_level, sort_order.
   It knows no setting by name. Adding a setting is a row, not a deploy.

   Why this exists: Settings used to be hand-written panels, and they
   rotted. The walkthrough (2026-09-11, Section 5) found a toggle that
   wrote a flag nothing reads, a false key-status warning
   two days after the key was rotated, and the real registration switch
   with no UI at all.

   WIRING — one global object, ConfigUI, and no IIFE. Controls are built
   with DOM calls and wired with addEventListener, never inline onclick,
   so nothing here depends on global name resolution. Nothing is hidden
   in a closure either: if an inline handler ever did call ConfigUI.*,
   it would still resolve. (W10.5 shipped register.html with its script
   in an IIFE and inline handlers outside it: the page rendered and every
   control was dead.)

   TEXT — labels, descriptions and values are data. They are only ever
   set with textContent or .value, never innerHTML.

   AUTHORITY — the database decides who may change what
   (trg_portal_config_guard, migration 02-coord-01). This file only
   reflects it: a control is disabled when the row's edit_level is not
   'coordinator' or when the page says the viewer cannot edit. If the
   database refuses a write anyway, its own message is shown on the row.
   No empty catch, no silent no-op.

   USE
     ConfigUI.render(hostElement, rows, {
       canEdit:   true | false,
       save:      async function (key, value) { return rowsWritten; },
       onSaved:   function (row) {},          // optional
       onError:   function (message) {},      // optional
       emptyText: 'Nothing to show.'          // optional
     });
   `rows` are portal_config rows with at least: key, value, label,
   description, value_type, group_name, edit_level, sort_order,
   updated_at. `save` must resolve to the rows the database actually
   wrote (PostgREST `Prefer: return=representation`) and throw on
   failure — sbPatch() in dashboard.html already does both.
=================================================================== */

var ConfigUI = {

  EDITABLE_LEVEL: 'coordinator',

  LOCKED_TEXT: 'Locked · SQL only',

  /* Groups in order of their lowest sort_order; rows by sort_order, then key. */
  groupRows: function (rows) {
    var sorted = rows.slice().sort(function (a, b) {
      var d = (a.sort_order || 0) - (b.sort_order || 0);
      return d !== 0 ? d : String(a.key).localeCompare(String(b.key));
    });
    var groups = [];
    var byName = {};
    sorted.forEach(function (row) {
      var name = row.group_name || 'Other';
      if (!byName[name]) {
        byName[name] = { name: name, rows: [] };
        groups.push(byName[name]);
      }
      byName[name].rows.push(row);
    });
    return groups;
  },

  render: function (host, rows, opts) {
    opts = opts || {};
    host.textContent = '';
    if (!Array.isArray(rows) || rows.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'cfg-empty';
      empty.textContent = opts.emptyText || 'No settings to show.';
      host.appendChild(empty);
      return 0;
    }
    var count = 0;
    ConfigUI.groupRows(rows).forEach(function (group) {
      var section = document.createElement('div');
      section.className = 'settings-section cfg-group';
      section.setAttribute('data-group', group.name);
      var h = document.createElement('h2');
      h.textContent = group.name;
      section.appendChild(h);
      group.rows.forEach(function (row) {
        section.appendChild(ConfigUI.buildRow(row, opts));
        count++;
      });
      host.appendChild(section);
    });
    return count;
  },

  isEditable: function (row, opts) {
    return !!(opts && opts.canEdit) && row.edit_level === ConfigUI.EDITABLE_LEVEL;
  },

  buildRow: function (row, opts, initialMessage) {
    var editable = ConfigUI.isEditable(row, opts);

    var wrap = document.createElement('div');
    wrap.className = 'setting-row cfg-row';
    wrap.setAttribute('data-key', row.key);

    // ── left: what it is ──────────────────────────────────────────
    var text = document.createElement('div');
    text.className = 'cfg-text';

    var label = document.createElement('div');
    label.className = 'setting-label';
    label.textContent = row.label || row.key;
    if (row.edit_level !== ConfigUI.EDITABLE_LEVEL) {
      var lock = document.createElement('span');
      lock.className = 'cfg-lock';
      lock.textContent = ConfigUI.LOCKED_TEXT;
      label.appendChild(lock);
    }
    text.appendChild(label);

    if (row.description) {
      var desc = document.createElement('div');
      desc.className = 'setting-desc';
      desc.textContent = row.description;
      text.appendChild(desc);
    }

    var meta = document.createElement('div');
    meta.className = 'cfg-meta';
    meta.textContent = row.key + (row.updated_at ? ' · last changed ' + ConfigUI.formatDate(row.updated_at) : '');
    text.appendChild(meta);

    var msg = document.createElement('div');
    msg.className = 'cfg-msg';
    msg.setAttribute('role', 'status');
    msg.setAttribute('aria-live', 'polite');
    text.appendChild(msg);

    wrap.appendChild(text);

    // ── right: the control ────────────────────────────────────────
    var side = document.createElement('div');
    side.className = 'cfg-control';

    var control = ConfigUI.buildControl(row, editable);
    side.appendChild(control.el);

    var setMsg = function (message, kind) {
      msg.textContent = message || '';
      msg.className = 'cfg-msg' + (kind ? ' ' + kind : '');
    };

    if (row.value_type === 'url') {
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn-secondary cfg-copy';
      copy.textContent = 'Copy';
      copy.addEventListener('click', function () {
        var saved = typeof row.value === 'string' ? row.value : '';
        if (!saved) { setMsg('There is no link saved to copy.', 'err'); return; }
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
          setMsg('This browser will not copy for the page. Select the link and copy it by hand.', 'err');
          return;
        }
        navigator.clipboard.writeText(saved).then(function () {
          setMsg('Link copied.', 'ok');
        }, function () {
          setMsg('The browser refused to copy. Select the link and copy it by hand.', 'err');
        });
      });
      side.appendChild(copy);
    }

    if (editable) {
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn-secondary cfg-save';
      save.textContent = 'Save';
      save.disabled = true;

      var refreshDirty = function () {
        save.disabled = !control.isDirty();
      };
      control.onInput(refreshDirty);
      control.onEnter(function () { if (!save.disabled) save.click(); });

      save.addEventListener('click', function () {
        var parsed = control.read();
        if (!parsed.ok) { setMsg(parsed.error, 'err'); return; }
        if (JSON.stringify(parsed.value) === JSON.stringify(row.value)) {
          setMsg('Nothing changed.', '');
          save.disabled = true;
          return;
        }
        if (typeof opts.save !== 'function') {
          setMsg('Saving is not available on this page.', 'err');
          return;
        }
        save.disabled = true;
        save.textContent = 'Saving…';
        setMsg('', '');
        Promise.resolve()
          .then(function () { return opts.save(row.key, parsed.value); })
          .then(function (written) {
            var w = Array.isArray(written) ? written[0] : written;
            if (!w || !Object.prototype.hasOwnProperty.call(w, 'value')) {
              throw new Error('The portal could not confirm that change was saved. Reload before trying again.');
            }
            // Show what the database now holds, not what was typed.
            row.value = w.value;
            if (w.updated_at) row.updated_at = w.updated_at;
            var fresh = ConfigUI.buildRow(row, opts, { text: 'Saved.', kind: 'ok' });
            if (wrap.parentNode) wrap.parentNode.replaceChild(fresh, wrap);
            if (typeof opts.onSaved === 'function') opts.onSaved(row);
          })
          .catch(function (e) {
            save.textContent = 'Save';
            save.disabled = !control.isDirty();
            var why = ConfigUI.errorText(e);
            setMsg('Not saved. ' + why, 'err');
            if (typeof opts.onError === 'function') opts.onError(row.label + ' was not saved. ' + why);
          });
      });
      side.appendChild(save);
    }

    wrap.appendChild(side);
    if (initialMessage) setMsg(initialMessage.text, initialMessage.kind);
    return wrap;
  },

  /* One control per value_type. Each returns:
       el        — the element to mount
       read()    — { ok:true, value } or { ok:false, error }
       isDirty() — true when what is in the control differs from row.value
       onInput(fn), onEnter(fn) — event hooks                                */
  buildControl: function (row, editable) {
    var type = row.value_type;
    var value = row.value;
    var inputHandlers = [];
    var enterHandlers = [];
    var fire = function (list) { list.forEach(function (fn) { fn(); }); };

    var api = {
      el: null,
      read: function () { return { ok: false, error: 'Unknown setting type.' }; },
      isDirty: function () {
        var r = api.read();
        return !r.ok || JSON.stringify(r.value) !== JSON.stringify(value);
      },
      onInput: function (fn) { inputHandlers.push(fn); },
      onEnter: function (fn) { enterHandlers.push(fn); }
    };

    var wireField = function (field, singleLine) {
      field.addEventListener('input', function () { fire(inputHandlers); });
      field.addEventListener('change', function () { fire(inputHandlers); });
      if (singleLine) {
        field.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); fire(enterHandlers); }
        });
      }
    };

    var lockField = function (field) {
      if (editable) return;
      if (field.tagName === 'TEXTAREA' || (field.type !== 'checkbox' && field.type !== 'number')) {
        field.readOnly = true;          // still selectable and copyable
      } else {
        field.disabled = true;
      }
      field.setAttribute('aria-readonly', 'true');
    };

    if (type === 'boolean') {
      var wrap = document.createElement('span');
      wrap.className = 'cfg-bool';
      var toggle = document.createElement('label');
      toggle.className = 'toggle';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = value === true;
      box.setAttribute('aria-label', row.label || row.key);
      var slider = document.createElement('span');
      slider.className = 'toggle-slider';
      toggle.appendChild(box);
      toggle.appendChild(slider);
      var state = document.createElement('span');
      state.className = 'cfg-state';
      var paint = function () { state.textContent = box.checked ? 'On' : 'Off'; };
      paint();
      box.addEventListener('change', function () { paint(); fire(inputHandlers); });
      if (!editable) box.disabled = true;
      wrap.appendChild(toggle);
      wrap.appendChild(state);
      api.el = wrap;
      api.read = function () { return { ok: true, value: box.checked }; };
      return api;
    }

    if (type === 'number') {
      var num = document.createElement('input');
      num.type = 'number';
      num.step = 'any';
      num.className = 'cfg-input cfg-num';
      num.value = typeof value === 'number' ? String(value) : '';
      num.setAttribute('aria-label', row.label || row.key);
      wireField(num, true);
      lockField(num);
      api.el = num;
      api.read = function () {
        var raw = num.value.trim();
        if (raw === '') return { ok: false, error: 'Enter a number.' };
        var n = Number(raw);
        if (!isFinite(n)) return { ok: false, error: 'Enter a number.' };
        return { ok: true, value: n };
      };
      return api;
    }

    if (type === 'text' || type === 'url') {
      var current = typeof value === 'string' ? value : '';
      var long = type === 'text' && (current.length > 60 || current.indexOf('\n') !== -1);
      var field = document.createElement(long ? 'textarea' : 'input');
      if (!long) field.type = type === 'url' ? 'url' : 'text';
      if (long) field.rows = 3;
      field.className = 'cfg-input' + (type === 'url' ? ' cfg-url' : '');
      if (type === 'url') field.placeholder = 'https://…';
      field.value = current;
      field.setAttribute('aria-label', row.label || row.key);
      wireField(field, !long);
      lockField(field);
      api.el = field;
      api.read = function () {
        var v = field.value.trim();
        if (type === 'url' && v !== '' && !/^(https?:\/\/|\/)/.test(v)) {
          return { ok: false, error: 'Enter a full link starting with https:// (or leave it blank).' };
        }
        return { ok: true, value: v };
      };
      return api;
    }

    if (type === 'list') {
      var items = Array.isArray(value) ? value : [];
      var listBox = document.createElement('textarea');
      listBox.className = 'cfg-input';
      listBox.rows = Math.min(Math.max(items.length, 3), 10);
      listBox.value = items.join('\n');
      listBox.setAttribute('aria-label', (row.label || row.key) + ' (one per line)');
      wireField(listBox, false);
      lockField(listBox);
      api.el = listBox;
      api.read = function () {
        var out = listBox.value.split('\n')
          .map(function (s) { return s.trim(); })
          .filter(function (s) { return s !== ''; });
        return { ok: true, value: out };
      };
      return api;
    }

    if (type === 'json') {
      var jsonBox = document.createElement('textarea');
      jsonBox.className = 'cfg-input cfg-mono';
      var pretty = '';
      try { pretty = JSON.stringify(value, null, 2); } catch (e) { pretty = String(value); }
      jsonBox.rows = Math.min(Math.max(pretty.split('\n').length, 3), 14);
      jsonBox.value = pretty;
      jsonBox.setAttribute('aria-label', row.label || row.key);
      wireField(jsonBox, false);
      lockField(jsonBox);
      api.el = jsonBox;
      api.read = function () {
        var parsed;
        try { parsed = JSON.parse(jsonBox.value); }
        catch (e) { return { ok: false, error: 'That is not valid JSON: ' + e.message }; }
        if (parsed === null || typeof parsed !== 'object') {
          return { ok: false, error: 'This setting must be a JSON object or list.' };
        }
        return { ok: true, value: parsed };
      };
      return api;
    }

    // A value_type this file does not know. The database CHECK allows only
    // the six above, so this means the two have drifted: say so, do not guess.
    var unknown = document.createElement('div');
    unknown.className = 'cfg-msg err';
    unknown.textContent = 'This page does not know how to show a "' + type + '" setting. Nothing can be changed here.';
    api.el = unknown;
    api.isDirty = function () { return false; };
    return api;
  },

  /* PostgREST errors arrive as JSON text inside Error.message (sbGet/sbPatch
     throw `await r.text()`). Show the database's own sentence when there is one. */
  errorText: function (e) {
    var raw = (e && e.message) ? e.message : String(e);
    var j = ConfigUI.parseJson(raw);
    if (j && (j.message || j.hint || j.details)) return j.message || j.hint || j.details;
    return raw;   // not JSON: the message is already a sentence
  },

  parseJson: function (text) {
    try { return JSON.parse(text); } catch (err) { return null; }
  },

  formatDate: function (iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
};
