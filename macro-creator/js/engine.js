/* Makro Studio – Engine: startet Auslöser, prüft Bedingungen und führt
 * Aktionslisten inklusive Wenn/Sonst/Schleifen aus. */
'use strict';
(function () {
  const MS = window.MS;
  const { uid, sleep, clone } = MS.util;
  const cat = () => MS.catalog;

  /** Ordnet If/Else/End If und Loop/End Loop einander zu (Sprungtabelle). */
  function buildFlow(actions) {
    const info = actions.map(() => ({}));
    const stack = [];
    const closeIf = (top, endIndex) => {
      top.branches.push(endIndex);
      for (let k = 0; k < top.branches.length - 1; k++) {
        info[top.branches[k]].next = top.branches[k + 1];
        info[top.branches[k]].end = endIndex;
      }
    };
    actions.forEach((a, i) => {
      const top = stack[stack.length - 1];
      switch (a.type) {
        case 'if': stack.push({ type: 'if', branches: [i] }); break;
        case 'loop': stack.push({ type: 'loop', i }); break;
        case 'else_if':
        case 'else':
          if (top && top.type === 'if') top.branches.push(i);
          break;
        case 'end_if':
          if (top && top.type === 'if') { stack.pop(); closeIf(top, i); }
          break;
        case 'end_loop':
          if (top && top.type === 'loop') { stack.pop(); info[top.i].end = i; info[i].start = top.i; }
          break;
      }
    });
    // Nicht geschlossene Blöcke reichen bis zum Ende der Liste
    while (stack.length) {
      const top = stack.pop();
      if (top.type === 'if') closeIf(top, actions.length);
      else info[top.i].end = actions.length;
    }
    return info;
  }

  /** Prüft die Struktur für den Editor: Einrückung und Warnungen. */
  function analyze(actions) {
    const depth = [], warnings = [];
    const stack = [];
    const name = (t) => cat().actions[t].name;
    actions.forEach((a, i) => {
      const top = stack[stack.length - 1];
      let d = stack.length;
      switch (a.type) {
        case 'if': case 'loop':
          stack.push({ type: a.type, i, hasElse: false });
          break;
        case 'else_if': case 'else':
          d--;
          if (!top || top.type !== 'if') { warnings.push(`#${i + 1} „${name(a.type)}“ steht nicht in einem Wenn-Block.`); d++; }
          else if (top.hasElse) warnings.push(`#${i + 1} „${name(a.type)}“ folgt auf „Sonst“.`);
          else if (a.type === 'else') top.hasElse = true;
          break;
        case 'end_if': case 'end_loop': {
          const want = a.type === 'end_if' ? 'if' : 'loop';
          if (top && top.type === want) { stack.pop(); d--; }
          else warnings.push(`#${i + 1} „${name(a.type)}“ hat keinen passenden Anfang.`);
          break;
        }
        case 'break_loop': case 'continue_loop':
          if (!stack.some((s) => s.type === 'loop')) warnings.push(`#${i + 1} „${name(a.type)}“ steht nicht in einer Schleife.`);
          break;
      }
      depth.push(Math.max(0, d));
    });
    stack.forEach((s) => warnings.push(`#${s.i + 1} „${name(s.type)}“ wird nicht geschlossen.`));
    return { depth, warnings };
  }

  const engine = (MS.engine = {
    stops: [],
    running: new Map(), // runId → ctx
    buildFlow,
    analyze,

    // ------------------------------------------------------------ Auslöser
    start() {
      this.stopTriggers();
      const s = MS.store.state;
      if (!s.settings.enabled) { MS.bus.emit('engine'); return; }
      for (const m of s.macros) {
        if (!m.enabled) continue;
        for (const t of m.triggers) {
          if (t.enabled === false) continue;
          const d = cat().triggers[t.type];
          if (!d) continue;
          try {
            const stop = d.start(t.params || {}, (info) => this.fire(m.id, t, info || {}), t);
            if (typeof stop === 'function') this.stops.push(stop);
          } catch (e) {
            MS.log('error', `Auslöser „${d.name}“ konnte nicht gestartet werden: ${e.message}`, m.name);
          }
        }
      }
      MS.bus.emit('engine');
    },
    stopTriggers() {
      this.stops.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
      this.stops = [];
    },
    restart() {
      clearTimeout(this._restartTimer);
      this._restartTimer = setTimeout(() => this.start(), 50);
    },
    fire(macroId, trigger, info) {
      const m = MS.store.macro(macroId);
      if (!m || !m.enabled || !MS.store.state.settings.enabled) return;
      const d = cat().triggers[trigger.type];
      this.runMacro(m, { trigger: d ? d.name : trigger.type, info: info.info });
    },

    // ---------------------------------------------------------- Bedingungen
    check(c, ctx) {
      if (c.enabled === false) return null;
      const d = cat().constraints[c.type];
      if (!d) return null;
      let ok = false;
      try { ok = !!d.check(ctx, c.params || {}); } catch (e) { MS.log('error', `Bedingung „${d.name}“: ${e.message}`, ctx && ctx.macroName); }
      return c.invert ? !ok : ok;
    },
    /** UND/ODER-Verknüpfung; deaktivierte Bedingungen zählen nicht, leere Liste = erfüllt. */
    checkAll(list, logic, ctx) {
      const results = (list || []).map((c) => this.check(c, ctx)).filter((r) => r !== null);
      if (!results.length) return true;
      return logic === 'or' ? results.some(Boolean) : results.every(Boolean);
    },

    // ------------------------------------------------------------ Ausführung
    context(macro, opts = {}) {
      const ctx = {
        runId: uid(),
        macroId: macro.id,
        macroName: macro.name || 'Unbenannt',
        trigger: opts.trigger || 'Manuell',
        triggerInfo: opts.info || '',
        locals: opts.locals || macro.localVars || [],
        token: opts.token || { cancelled: false },
        iteration: 0,
        depth: opts.depth || 0,
        stop(reason) {
          this.token.cancelled = true;
          this.token.quiet = true;
          if (reason) MS.log('info', 'Makro beendet: ' + reason, this.macroName);
        },
      };
      return ctx;
    },

    async runMacro(macro, opts = {}) {
      const ctx = this.context(macro, opts);
      if (!opts.ignoreConstraints && !this.checkAll(macro.constraints, macro.constraintLogic, ctx)) {
        MS.log('info', `Bedingungen nicht erfüllt – nicht ausgeführt (Auslöser: ${ctx.trigger})`, ctx.macroName);
        return false;
      }
      MS.log('info', `Makro gestartet – Auslöser: ${ctx.trigger}${ctx.triggerInfo ? ' (' + ctx.triggerInfo + ')' : ''}`, ctx.macroName);
      if (MS.store.macro(macro.id) === macro) {
        macro.lastRun = Date.now();
        MS.store.save();
      }
      this.running.set(ctx.runId, ctx);
      MS.bus.emit('running');
      try {
        await this.runActions(macro.actions, ctx);
      } finally {
        this.running.delete(ctx.runId);
        MS.bus.emit('running');
      }
      if (ctx.token.cancelled && !ctx.token.quiet) MS.log('warn', 'Makro abgebrochen', ctx.macroName);
      return !ctx.token.cancelled;
    },

    /** Führt einen Action Block mit eigenen (frischen) lokalen Variablen aus. */
    async runBlock(block, io, parentCtx) {
      const locals = clone(block.localVars || []);
      for (const v of locals) {
        if (io.inputs && io.inputs[v.name] !== undefined && io.inputs[v.name] !== '') {
          v.value = MS.vars.coerce(v.type, MS.magic.apply(io.inputs[v.name], parentCtx));
        }
      }
      const ctx = this.context(block, {
        locals,
        token: parentCtx.token,
        depth: parentCtx.depth + 1,
        trigger: parentCtx.trigger,
        info: parentCtx.triggerInfo,
      });
      ctx.macroName = parentCtx.macroName + ' › ' + (block.name || 'Block');
      await this.runActions(block.actions, ctx);
      for (const v of locals) {
        const target = io.outputs && io.outputs[v.name];
        if (target) MS.vars.set(target, v.value, parentCtx);
      }
    },

    async runActions(actions, ctx) {
      const flow = buildFlow(actions);
      const frames = [];
      const A = cat().actions;
      let pc = 0, steps = 0;
      const logActions = MS.store.state.settings.logActions;
      while (pc < actions.length) {
        if (ctx.token.cancelled) return false;
        if (++steps % 100 === 0) await sleep(0); // UI nicht blockieren
        const a = actions[pc], f = flow[pc], p = a.params || {};
        switch (a.type) {
          case 'if': {
            if (this.checkAll(p.conditions, p.logic, ctx)) { pc++; break; }
            let j = f.next;
            for (;;) {
              const b = actions[j];
              if (!b || b.type === 'end_if') { pc = j + 1; break; }
              if (b.type === 'else') { pc = j + 1; break; }
              if (this.checkAll(b.params && b.params.conditions, b.params && b.params.logic, ctx)) { pc = j + 1; break; }
              j = flow[j].next;
            }
            break;
          }
          case 'else_if':
          case 'else':
            // Ein vorheriger Zweig wurde ausgeführt → ans Blockende springen
            pc = f.end !== undefined ? f.end + 1 : pc + 1;
            break;
          case 'end_if':
            pc++;
            break;
          case 'loop': {
            let fr = frames[frames.length - 1];
            if (!fr || fr.start !== pc) { fr = { start: pc, end: f.end, iter: 0 }; frames.push(fr); }
            else fr.iter++;
            const go = p.mode === 'forever' ? true
              : p.mode === 'while' ? this.checkAll(p.conditions, p.logic, ctx)
              : fr.iter < (Number(p.count) || 0);
            if (go) { ctx.iteration = fr.iter + 1; pc++; }
            else { frames.pop(); ctx.iteration = frames.length ? frames[frames.length - 1].iter + 1 : 0; pc = f.end + 1; }
            break;
          }
          case 'end_loop':
            pc = f.start !== undefined ? f.start : pc + 1;
            if (f.start !== undefined) await sleep(0);
            break;
          case 'break_loop': {
            const fr = frames.pop();
            pc = fr ? fr.end + 1 : pc + 1;
            ctx.iteration = frames.length ? frames[frames.length - 1].iter + 1 : 0;
            break;
          }
          case 'continue_loop': {
            const fr = frames[frames.length - 1];
            pc = fr ? fr.start : pc + 1;
            break;
          }
          default: {
            pc++;
            if (a.enabled === false) break;
            const d = A[a.type];
            if (!d) { MS.log('warn', `Unbekannte Aktion „${a.type}“ übersprungen`, ctx.macroName); break; }
            if (logActions) MS.log('action', d.name + (d.describe ? ': ' + MS.catalog.describe('action', a) : ''), ctx.macroName);
            try {
              await d.run(ctx, p);
            } catch (e) {
              MS.log('error', `${d.name}: ${e && e.message ? e.message : e}`, ctx.macroName);
            }
          }
        }
      }
      return true;
    },

    /** Einzelne Aktion testen (z. B. aus dem Editor). */
    async testAction(action, owner) {
      const ctx = this.context(owner, { trigger: 'Test' });
      await this.runActions([action], ctx);
    },

    // ------------------------------------------------------------- Abbrechen
    cancel(macroId) {
      let n = 0;
      for (const ctx of this.running.values()) {
        if (macroId === null || ctx.macroId === macroId) { ctx.token.cancelled = true; n++; }
      }
      if ('speechSynthesis' in window && macroId === null) speechSynthesis.cancel();
      return n;
    },
    isRunning(macroId, exceptRunId) {
      for (const ctx of this.running.values()) if (ctx.macroId === macroId && ctx.runId !== exceptRunId) return true;
      return false;
    },
  });

  MS.bus.on('store', (what) => {
    if (what === 'macros' || what === 'settings' || what === 'all') engine.restart();
  });
})();
