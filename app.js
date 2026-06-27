/* Pazo Baion GPS Beta 0.2
   Pantallas estáticas aprobadas + zonas táctiles invisibles.
   Todas las vistas son fijas, no deslizantes. */

(() => {
  'use strict';

  const VERSION = 'Beta 0.2';
  const LS_KEY = 'pazo_baion_gps_beta_0_2_state';
  const HISTORY_KEY = 'pazo_baion_gps_beta_0_2_history';
  const img = document.getElementById('screenImage');
  const hotspots = document.getElementById('hotspots');
  const toast = document.getElementById('statusToast');

  const screens = {
    splash: 'assets/splash.png',
    config: 'assets/config.png',
    selectParcel: 'assets/select-parcel.png',
    parcelSelected: 'assets/parcel-selected.png',
    workType: 'assets/work-type.png',
    gpsCalibration: 'assets/gps-calibration.png',
    workWorking: 'assets/work-working.png',
    workStopped: 'assets/work-stopped.png',
    report: 'assets/report.png',
    history: 'assets/history.png'
  };

  const defaultState = () => ({
    version: VERSION,
    screen: 'splash',
    jornada: {
      fecha: todayISO(),
      operario: 'Manuel',
      tractor: 'Tractor 1',
      atomizador: 'Atomizador 1000 L',
      trabajoPrevisto: 'Aplicación de fitosanitarios'
    },
    parcela: 'Bodega/Castro',
    tipoTrabajo: 'Aplicación de fitosanitarios',
    gps: {
      lastAccuracy: null,
      quality: 'Sin comprobar',
      forcedStart: false,
      initialAccuracy: null,
      initialQuality: null,
      device: userDevice()
    },
    currentWork: null
  });

  let state = loadState();
  let watchId = null;
  let toastTimer = null;

  const zoneMap = {
    splash: [],
    config: [
      z('config-start', 5.5, 76.0, 89.0, 7.2, () => { iniciarJornada(); go('selectParcel'); }, 'Iniciar jornada'),
      z('config-change', 6.0, 84.2, 88.5, 5.5, cambiarConfiguracion, 'Cambiar configuración'),
      z('config-back', 6.0, 91.2, 88.5, 5.5, () => go('selectParcel'), 'Regresar'),
      z('config-operario', 5.5, 32.5, 89.0, 7.5, () => selectFromList('operario', ['Manuel','Operario 2','Operario 3']), 'Operario'),
      z('config-tractor', 5.5, 41.1, 89.0, 7.5, () => selectFromList('tractor', ['Tractor 1','Tractor 2']), 'Tractor'),
      z('config-atomizador', 5.5, 49.7, 89.0, 7.5, () => selectFromList('atomizador', ['Atomizador 1000 L','Atomizador 2']), 'Atomizador')
    ],
    selectParcel: [
      z('sel-map', 3.5, 25.0, 93.0, 59.5, () => { state.parcela = 'Bodega/Castro'; saveState(); go('parcelSelected'); }, 'Seleccionar parcela'),
      z('sel-bodega', 22, 38, 35, 12, () => selectParcel('Bodega/Castro'), 'Bodega/Castro'),
      z('sel-pazo', 55, 38, 29, 14, () => selectParcel('Pazo'), 'Pazo'),
      z('sel-palmeras', 7, 48, 32, 25, () => selectParcel('Palmeras'), 'Palmeras'),
      z('sel-grande', 36, 52, 36, 22, () => selectParcel('Grande'), 'Grande'),
      z('sel-medico', 65, 55, 28, 22, () => selectParcel('Médico'), 'Médico'),
      z('sel-entrada', 39, 70, 39, 12, () => selectParcel('Entrada'), 'Entrada'),
      z('sel-back', 5, 89, 27, 6, () => go('config'), 'Regresar')
    ],
    parcelSelected: [
      z('parcel-work', 4.5, 75.0, 29.0, 13.5, () => go('workType'), 'Trabajar en parcela'),
      z('parcel-incident', 35.5, 75.0, 29.0, 13.5, registrarIncidencia, 'Señalizar incidencia'),
      z('parcel-back', 67.0, 75.0, 28.0, 13.5, () => go('selectParcel'), 'Regresar'),
      z('parcel-map', 4.5, 24.2, 91.0, 38.5, () => showToast('Parcela seleccionada: ' + state.parcela), 'Mapa parcela')
    ],
    workType: [
      z('work-fit', 7, 35.0, 86, 13.6, () => chooseWorkType('Aplicación de fitosanitarios'), 'Aplicación de fitosanitarios'),
      z('work-des', 7, 50.5, 86, 13.6, () => chooseWorkType('Desbroce'), 'Desbroce'),
      z('work-otro', 7, 66.0, 86, 13.6, () => chooseOtherWorkType(), 'Otro'),
      z('work-back', 30, 86.8, 40, 6.5, () => go('parcelSelected'), 'Regresar')
    ],
    gpsCalibration: [
      z('gps-retry', 5.5, 74.7, 88.5, 6.0, calibrarGPS, 'Reintentar GPS'),
      z('gps-force', 5.5, 81.0, 88.5, 5.8, comenzarDeTodosModos, 'Comenzar de todos modos'),
      z('gps-back', 5.5, 86.9, 88.5, 5.8, () => go('workType'), 'Volver')
    ],
    workWorking: [
      z('ww-stop', 4.0, 87.0, 92.0, 9.0, abrirParada, 'Parada'),
      z('ww-back', 4.0, 79.0, 20.0, 4.5, () => go('parcelSelected'), 'Regresar'),
      z('ww-cancel', 25.5, 79.0, 21.0, 4.5, cancelarTrabajo, 'Cancelar'),
      z('ww-delete', 48.0, 79.0, 21.0, 4.5, borrarTrabajo, 'Borrar'),
      z('ww-report', 70.0, 79.0, 25.0, 4.5, () => go('report'), 'Generar informe'),
      z('ww-map', 3.0, 35.7, 94.0, 38.5, () => showToast('Vista mapa: parcela + ruta GPS + satélite real'), 'Mapa trabajo'),
      z('ww-center', 84.0, 66.0, 10.0, 8.0, centerOnTractor, 'Centrar tractor')
    ],
    workStopped: [
      z('ws-recarga', 4.0, 77.0, 45.0, 3.8, () => seleccionarMotivoParada('Recarga cisterna'), 'Recarga cisterna'),
      z('ws-otro', 50.0, 77.0, 46.0, 3.8, () => seleccionarMotivoParada('Otro motivo'), 'Otro motivo'),
      z('ws-pausa', 4.0, 81.0, 45.0, 3.8, () => seleccionarMotivoParada('Pausa técnica / incidencia'), 'Pausa técnica'),
      z('ws-fin', 50.0, 81.0, 46.0, 3.8, finalizarTrabajo, 'Fin de tratamiento'),
      z('ws-averia', 4.0, 85.0, 45.0, 3.8, () => seleccionarMotivoParada('Avería / revisión'), 'Avería'),
      z('ws-cancel-option', 50.0, 85.0, 46.0, 3.8, () => go('workWorking'), 'Cancelar parada'),
      z('ws-continue', 4.0, 90.4, 92.0, 7.2, continuarTrabajo, 'Continuar'),
      z('ws-back', 4.0, 67.5, 20.0, 4.5, () => go('parcelSelected'), 'Regresar'),
      z('ws-cancel', 25.5, 67.5, 21.0, 4.5, cancelarTrabajo, 'Cancelar'),
      z('ws-delete', 48.0, 67.5, 21.0, 4.5, borrarTrabajo, 'Borrar'),
      z('ws-report', 70.0, 67.5, 25.0, 4.5, () => go('report'), 'Generar informe')
    ],
    report: [
      z('rep-pdf', 5.0, 92.0, 28.0, 5.0, verPDF, 'Ver PDF'),
      z('rep-share', 36.0, 92.0, 28.0, 5.0, compartirInforme, 'Compartir'),
      z('rep-history', 67.0, 92.0, 28.0, 5.0, () => go('history'), 'Historial'),
      z('rep-resumen', 4.0, 65.3, 22.0, 4.0, () => showToast('Resumen del informe'), 'Resumen'),
      z('rep-mapa', 27.0, 65.3, 22.0, 4.0, () => showToast('Mapa del informe'), 'Mapa'),
      z('rep-eventos', 50.0, 65.3, 22.0, 4.0, descargarCSV, 'Eventos'),
      z('rep-exportar', 73.0, 65.3, 22.0, 4.0, exportarInformeJSON, 'Exportar')
    ],
    history: [
      z('hist-back', 5.5, 91.0, 36.0, 6.0, () => go('selectParcel'), 'Regresar'),
      z('hist-export', 49.0, 91.0, 45.0, 6.0, exportarHistorial, 'Exportar historial'),
      z('hist-report1', 69.0, 42.2, 22.0, 5.0, () => go('report'), 'Ver informe'),
      z('hist-report2', 69.0, 60.0, 22.0, 5.0, () => go('report'), 'Ver informe'),
      z('hist-report3', 69.0, 77.5, 22.0, 5.0, () => go('report'), 'Ver informe')
    ]
  };

  function z(id, x, y, w, h, fn, label) { return {id, x, y, w, h, fn, label}; }

  function go(screen) {
    state.screen = screen;
    saveState();
    img.src = screens[screen];
    img.alt = 'Pantalla ' + screen + ' - Pazo Baion GPS';
    renderHotspots(screen);
    if (screen === 'workWorking') ensureWorkStarted();
    if (screen !== 'workWorking' && screen !== 'workStopped') stopGPSWatch(false);
  }

  function renderHotspots(screen) {
    hotspots.innerHTML = '';
    (zoneMap[screen] || []).forEach(zone => {
      const b = document.createElement('button');
      b.className = 'hotspot';
      b.type = 'button';
      b.setAttribute('aria-label', zone.label || zone.id);
      b.style.left = zone.x + '%';
      b.style.top = zone.y + '%';
      b.style.width = zone.w + '%';
      b.style.height = zone.h + '%';
      b.addEventListener('click', (ev) => { ev.preventDefault(); zone.fn(); });
      hotspots.appendChild(b);
    });
  }

  function iniciarJornada() {
    state.jornada.fecha = todayISO();
    showToast('Jornada iniciada: ' + state.jornada.operario + ' · ' + state.jornada.tractor + ' · ' + state.jornada.atomizador);
  }

  function cambiarConfiguracion() {
    const op = prompt('Operario de la jornada:', state.jornada.operario);
    if (op) state.jornada.operario = op.trim();
    const tr = prompt('Tractor:', state.jornada.tractor);
    if (tr) state.jornada.tractor = tr.trim();
    const at = prompt('Atomizador / cisterna:', state.jornada.atomizador);
    if (at) state.jornada.atomizador = at.trim();
    saveState();
    showToast('Configuración de jornada guardada. Se mantendrá hasta cambiarla.');
  }

  function selectFromList(field, values) {
    const current = state.jornada[field];
    const i = values.indexOf(current);
    state.jornada[field] = values[(i + 1 + values.length) % values.length];
    saveState();
    showToast(field + ': ' + state.jornada[field]);
  }

  function selectParcel(name) {
    state.parcela = name;
    saveState();
    go('parcelSelected');
  }

  function registrarIncidencia() {
    const obs = prompt('Observación de incidencia en ' + state.parcela + ':', '');
    if (obs !== null) {
      const inc = { fecha: new Date().toISOString(), parcela: state.parcela, tipo: 'Otra', observacion: obs };
      const history = loadHistory();
      history.incidencias = history.incidencias || [];
      history.incidencias.push(inc);
      saveHistory(history);
      showToast('Incidencia guardada para ' + state.parcela);
    }
  }

  function chooseWorkType(type) {
    state.tipoTrabajo = type;
    state.jornada.trabajoPrevisto = type;
    saveState();
    go('gpsCalibration');
    setTimeout(() => calibrarGPS(false), 400);
  }

  function chooseOtherWorkType() {
    const tipo = prompt('Describe el tipo de trabajo:', 'Otro');
    if (tipo) chooseWorkType(tipo.trim());
  }

  function calibrarGPS(showDone = true) {
    if (!('geolocation' in navigator)) {
      state.gps.lastAccuracy = null;
      state.gps.quality = 'No disponible';
      saveState();
      showToast('GPS no disponible en este navegador. Puedes comenzar de todos modos.');
      return;
    }
    showToast('Comprobando GPS... espere unos segundos.');
    navigator.geolocation.getCurrentPosition(pos => {
      const acc = Math.round(pos.coords.accuracy || 0);
      state.gps.lastAccuracy = acc;
      state.gps.quality = gpsQuality(acc);
      state.gps.device = userDevice();
      saveState();
      const msg = 'GPS: ±' + acc + ' m · Estado: ' + state.gps.quality + (acc <= 10 ? ' · Puede iniciar.' : ' · Precisión insuficiente. Reintente o comience de todos modos.');
      if (showDone) alert(msg);
      showToast(msg);
          }, err => {
      state.gps.quality = 'Sin permiso / error';
      saveState();
      showToast('No se pudo leer el GPS. Active permisos o comience de todos modos.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  function comenzarDeTodosModos() {
    state.gps.forcedStart = true;
    state.gps.initialAccuracy = state.gps.lastAccuracy;
    state.gps.initialQuality = state.gps.quality;
    saveState();
    comenzarTrabajo(true);
  }

  function comenzarTrabajo(forzado) {
    if (!state.currentWork) {
      state.currentWork = newWork();
    }
    if (forzado) state.currentWork.gpsInicioForzado = true;
    state.currentWork.estado = 'Trabajando';
    state.currentWork.eventos.push(evento('Comienzo', 'Inicio de trabajo'));
    state.currentWork.gps.initialAccuracy = state.gps.lastAccuracy;
    state.currentWork.gps.initialQuality = state.gps.quality;
    state.currentWork.gps.forcedStart = !!forzado;
    saveState();
    go('workWorking');
    startGPSWatch();
  }

  function ensureWorkStarted() {
    if (!state.currentWork) state.currentWork = newWork();
    if (!state.currentWork.inicio) state.currentWork.inicio = new Date().toISOString();
    state.currentWork.estado = 'Trabajando';
    saveState();
    startGPSWatch();
  }

  function abrirParada() {
    ensureWorkStarted();
    state.currentWork.estado = 'Parado';
    state.currentWork.eventos.push(evento('Parada', 'Pendiente de motivo'));
    saveState();
    stopGPSWatch(false);
    go('workStopped');
  }

  function seleccionarMotivoParada(motivo) {
    ensureWorkStarted();
    state.currentWork.estado = 'Parado';
    state.currentWork.ultimaParada = motivo;
    state.currentWork.eventos.push(evento('Parada', motivo));
    if (motivo === 'Recarga cisterna') state.currentWork.recargas += 1;
    saveState();
    showToast('Parada guardada: ' + motivo + '. Pulse Continuar para reanudar.');
  }

  function continuarTrabajo() {
    ensureWorkStarted();
    state.currentWork.estado = 'Trabajando';
    state.currentWork.eventos.push(evento('Continuar', state.currentWork.ultimaParada || 'Reanudación'));
    saveState();
    go('workWorking');
    startGPSWatch();
  }

  function finalizarTrabajo() {
    ensureWorkStarted();
    state.currentWork.estado = 'Finalizado';
    state.currentWork.fin = new Date().toISOString();
    state.currentWork.eventos.push(evento('Punto final', 'Fin de tratamiento de la parcela'));
    stopGPSWatch(false);
    saveCurrentWorkToHistory();
    saveState();
    go('report');
  }

  function cancelarTrabajo() {
    if (confirm('¿Cancelar el trabajo actual? Se conservará como cancelado en el historial.')) {
      if (state.currentWork) {
        state.currentWork.estado = 'Cancelado';
        state.currentWork.fin = new Date().toISOString();
        saveCurrentWorkToHistory();
      }
      state.currentWork = null;
      saveState();
      stopGPSWatch(false);
      go('parcelSelected');
    }
  }

  function borrarTrabajo() {
    if (confirm('¿Borrar el registro de trabajo actual? Esta acción solo afecta a esta beta local.')) {
      state.currentWork = null;
      saveState();
      stopGPSWatch(false);
      showToast('Registro borrado.');
      go('parcelSelected');
    }
  }

  function centerOnTractor() {
    showToast('Vista tractor activada. Si manipula el mapa, el recentrado se desactiva hasta volver a centrar.');
  }

  function startGPSWatch() {
    if (watchId !== null || !('geolocation' in navigator) || !state.currentWork) return;
    watchId = navigator.geolocation.watchPosition(pos => {
      const p = gpsPoint(pos);
      state.currentWork.gps.raw.push(p);
      const corrected = depurarPunto(p, state.currentWork.gps.corrected[state.currentWork.gps.corrected.length - 1]);
      if (corrected.status !== 'descartado') state.currentWork.gps.corrected.push(corrected);
      else state.currentWork.gps.discarded += 1;
      if (corrected.status === 'dudoso') state.currentWork.gps.doubtful += 1;
      state.gps.lastAccuracy = Math.round(pos.coords.accuracy || 0);
      state.gps.quality = gpsQuality(state.gps.lastAccuracy);
      saveState();
    }, err => {
      showToast('GPS: ' + err.message);
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
  }

  function stopGPSWatch(clear = true) {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (clear) showToast('Registro GPS pausado.');
  }

  function depurarPunto(p, prev) {
    const out = {...p, status: 'valido'};
    if (p.accuracy > 15) out.status = 'descartado';
    else if (p.accuracy > 10) out.status = 'dudoso';
    if (prev) {
      const dt = Math.max(1, (new Date(p.time) - new Date(prev.time)) / 1000);
      const dist = haversine(prev.lat, prev.lon, p.lat, p.lon);
      const speedKmh = (dist / dt) * 3.6;
      out.computedSpeedKmh = Number(speedKmh.toFixed(2));
      if (speedKmh > 18) out.status = 'descartado';
      else if (speedKmh > 10) out.status = 'dudoso';
    }
    return out;
  }

  function gpsPoint(pos) {
    return {
      time: new Date().toISOString(),
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: Math.round(pos.coords.accuracy || 0),
      speed: pos.coords.speed === null ? null : pos.coords.speed,
      heading: pos.coords.heading === null ? null : pos.coords.heading,
      device: userDevice()
    };
  }

  function evento(tipo, motivo) {
    return {
      time: new Date().toISOString(),
      tipo,
      motivo,
      parcela: state.parcela,
      trabajo: state.tipoTrabajo,
      gpsAccuracy: state.gps.lastAccuracy,
      gpsQuality: state.gps.quality
    };
  }

  function newWork() {
    return {
      id: 'trabajo-' + Date.now(),
      version: VERSION,
      parcela: state.parcela,
      tipoTrabajo: state.tipoTrabajo,
      jornada: {...state.jornada},
      inicio: new Date().toISOString(),
      fin: null,
      estado: 'Preparado',
      recargas: 0,
      ultimaParada: null,
      gpsInicioForzado: false,
      eventos: [],
      gps: {
        initialAccuracy: state.gps.lastAccuracy,
        initialQuality: state.gps.quality,
        forcedStart: state.gps.forcedStart,
        device: userDevice(),
        raw: [],
        corrected: [],
        discarded: 0,
        doubtful: 0
      }
    };
  }

  function saveCurrentWorkToHistory() {
    if (!state.currentWork) return;
    const history = loadHistory();
    history.trabajos = history.trabajos || [];
    const idx = history.trabajos.findIndex(t => t.id === state.currentWork.id);
    if (idx >= 0) history.trabajos[idx] = state.currentWork;
    else history.trabajos.unshift(state.currentWork);
    saveHistory(history);
  }

  function verPDF() {
    showToast('Se abrirá la vista de impresión. En iPhone puede guardar como PDF desde Compartir.');
    setTimeout(() => window.print(), 500);
  }

  async function compartirInforme() {
    const work = state.currentWork || latestWork();
    const text = resumenTexto(work);
    if (navigator.share) {
      try { await navigator.share({ title: 'Informe Pazo Baion GPS', text }); }
      catch (_) {}
    } else {
      await navigator.clipboard?.writeText(text).catch(() => null);
      alert(text);
    }
  }

  function exportarInformeJSON() {
    downloadFile('informe_pazo_baion_gps_' + dateFile() + '.json', JSON.stringify(state.currentWork || latestWork() || state, null, 2), 'application/json');
  }

  function descargarCSV() {
    const work = state.currentWork || latestWork();
    const rows = [['hora','tipo','motivo','parcela','trabajo','gps_accuracy','gps_quality']];
    (work?.eventos || []).forEach(e => rows.push([e.time, e.tipo, e.motivo, e.parcela, e.trabajo, e.gpsAccuracy ?? '', e.gpsQuality ?? '']));
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\n');
    downloadFile('eventos_pazo_baion_gps_' + dateFile() + '.csv', csv, 'text/csv');
  }

  function exportarHistorial() {
    downloadFile('historial_pazo_baion_gps_' + dateFile() + '.json', JSON.stringify(loadHistory(), null, 2), 'application/json');
  }

  function latestWork() {
    const h = loadHistory();
    return (h.trabajos || [])[0] || null;
  }

  function resumenTexto(work) {
    if (!work) return 'Pazo Baion GPS - no hay informe generado.';
    const gps = work.gps || {};
    return [
      'Pazo Baion GPS - Informe de trabajo',
      'Parcela: ' + work.parcela,
      'Trabajo: ' + work.tipoTrabajo,
      'Operario: ' + (work.jornada?.operario || ''),
      'Tractor: ' + (work.jornada?.tractor || ''),
      'Atomizador/cisterna: ' + (work.jornada?.atomizador || ''),
      'Estado: ' + work.estado,
      'Inicio: ' + fmt(work.inicio),
      'Fin: ' + (work.fin ? fmt(work.fin) : '—'),
      'Recargas: ' + (work.recargas || 0),
      'GPS inicial: ' + (gps.initialAccuracy ? '±' + gps.initialAccuracy + ' m' : '—'),
      'Inicio forzado por baja precisión: ' + (gps.forcedStart ? 'Sí' : 'No'),
      'Puntos GPS originales: ' + (gps.raw?.length || 0),
      'Puntos dudosos: ' + (gps.doubtful || 0),
      'Puntos descartados: ' + (gps.discarded || 0)
    ].join('\n');
  }

  function showToast(message, ms = 2600) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
  }

  function saveState() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }
  function loadState() {
    try { return {...defaultState(), ...(JSON.parse(localStorage.getItem(LS_KEY)) || {})}; }
    catch { return defaultState(); }
  }
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {trabajos: [], incidencias: []}; }
    catch { return {trabajos: [], incidencias: []}; }
  }
  function saveHistory(h) { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); }

  function gpsQuality(acc) {
    if (acc === null || acc === undefined) return 'Sin dato';
    if (acc <= 5) return 'Buena';
    if (acc <= 10) return 'Aceptable';
    if (acc <= 15) return 'Insuficiente';
    return 'Mala';
  }

  function todayISO() { return new Date().toISOString().slice(0,10); }
  function dateFile() { return new Date().toISOString().replace(/[:.]/g,'-').slice(0,19); }
  function fmt(iso) { try { return new Date(iso).toLocaleString('es-ES'); } catch { return iso || ''; } }
  function userDevice() { return navigator.userAgent || 'Dispositivo no identificado'; }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2-lat1);
    const dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // Inicio de la beta: pantalla de carga durante ~4 segundos.
  state.screen = 'splash';
  img.src = screens.splash;
  renderHotspots('splash');
  saveState();
  setTimeout(() => {
    if (state.screen === 'splash') go('config');
  }, 4000);

  // Pequeño acceso de depuración: tocar 5 veces la esquina superior izquierda muestra zonas táctiles.
  let debugTaps = [];
  document.addEventListener('click', (e) => {
    const rect = document.querySelector('.phone-frame').getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0.12 && y < 0.10) {
      debugTaps.push(Date.now());
      debugTaps = debugTaps.filter(t => Date.now() - t < 2500);
      if (debugTaps.length >= 5) document.body.classList.toggle('debug');
    }
  }, true);
})();
