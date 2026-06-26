(() => {
  'use strict';

  const VERSION = 'BETA 0.1';
  const DEFAULT_CATALOGS = {
    operarios: ['Operario 1', 'Operario 2', 'Operario 3'],
    tractores: ['Tractor 1', 'Tractor 2'],
    atomizadores: ['Atomizador 1', 'Atomizador 2']
  };
  const MAX_TRACTOR_SPEED_KMH = 15;
  const BAD_ACCURACY_M = 15;
  const WARN_ACCURACY_M = 10;

  const $ = (id) => document.getElementById(id);
  const screens = ['screenConfig','screenSelect','screenParcel','screenWorkType','screenCalibration','screenWork','screenReport','screenHistory'];
  const state = {
    catalogs: load('pb_catalogs', DEFAULT_CATALOGS),
    day: load('pb_day', null),
    screen: 'screenConfig',
    map: null,
    parcelLayer: null,
    selectedLayer: null,
    selectedFeature: null,
    selectedName: null,
    workType: null,
    follow: true,
    calibration: null,
    watchId: null,
    timerId: null,
    currentWork: null,
    routeLayer: null,
    eventLayer: null,
    tractorMarker: null,
    reports: load('pb_reports', []),
    incidences: load('pb_incidences', [])
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    fillCatalogs();
    bindEvents();
    setTimeout(() => {
      $('splash').classList.add('hidden');
      $('app').classList.remove('hidden');
      initMap();
      if (state.day) {
        fillDayFromState();
        showScreen('screenSelect');
      } else {
        showScreen('screenConfig');
      }
    }, 4000);
  }

  function bindEvents() {
    $('btnStartDay').addEventListener('click', startDay);
    $('btnUseDay').addEventListener('click', () => {
      if (!state.day) startDay(); else showScreen('screenSelect');
    });
    $('btnSaveCatalogs').addEventListener('click', saveCatalogs);
    $('btnConfig').addEventListener('click', () => showScreen('screenConfig'));
    $('btnBack').addEventListener('click', goBack);
    $('btnFitParcel').addEventListener('click', fitCurrentParcelOrAll);
    $('btnFollow').addEventListener('click', () => { state.follow = true; centerOnTractor(); });
    $('btnWork').addEventListener('click', () => showScreen('screenWorkType'));
    $('btnIncident').addEventListener('click', openIncidentModal);
    document.querySelectorAll('.choice').forEach(btn => btn.addEventListener('click', () => {
      state.workType = btn.dataset.worktype;
      showScreen('screenCalibration');
      resetCalibration();
    }));
    $('btnCheckGps').addEventListener('click', checkGps);
    $('btnRetryGps').addEventListener('click', checkGps);
    $('btnEnterWork').addEventListener('click', enterWorkScreen);
    $('btnForceWork').addEventListener('click', () => {
      if (state.calibration) state.calibration.forced = true;
      enterWorkScreen();
    });
    $('btnBegin').addEventListener('click', beginWork);
    $('btnStop').addEventListener('click', openStopModal);
    $('btnContinue').addEventListener('click', continueWork);
    $('btnCancelWork').addEventListener('click', cancelWork);
    $('btnDeleteWork').addEventListener('click', deleteWork);
    $('btnReturnParcel').addEventListener('click', () => {
      if (state.currentWork && ['trabajando','parado'].includes(state.currentWork.status)) {
        if (!confirm('Hay un trabajo abierto. ¿Regresar sin finalizar?')) return;
      }
      showScreen('screenParcel');
    });
    $('btnReport').addEventListener('click', generateReport);
    $('btnPrintReport').addEventListener('click', () => window.print());
    $('btnShareReport').addEventListener('click', shareReport);
    $('btnExportJson').addEventListener('click', exportJson);
    $('btnExportCsv').addEventListener('click', exportCsv);
    $('btnHistory').addEventListener('click', () => showHistory());
  }

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch (_) { return fallback; }
  }
  function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  function fillCatalogs() {
    const { operarios, tractores, atomizadores } = state.catalogs;
    fillSelect('selOperario', operarios);
    fillSelect('selTractor', tractores);
    fillSelect('selAtomizador', atomizadores);
    $('inpOperarios').value = operarios.join(', ');
    $('inpTractores').value = tractores.join(', ');
    $('inpAtomizadores').value = atomizadores.join(', ');
  }
  function fillSelect(id, arr) {
    const sel = $(id); sel.innerHTML = '';
    arr.forEach(v => { const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o); });
  }
  function saveCatalogs() {
    state.catalogs = {
      operarios: splitList($('inpOperarios').value) || DEFAULT_CATALOGS.operarios,
      tractores: splitList($('inpTractores').value) || DEFAULT_CATALOGS.tractores,
      atomizadores: splitList($('inpAtomizadores').value) || DEFAULT_CATALOGS.atomizadores
    };
    save('pb_catalogs', state.catalogs);
    fillCatalogs();
    toast('Listas guardadas.');
  }
  function splitList(text) { const arr = text.split(',').map(s=>s.trim()).filter(Boolean); return arr.length ? arr : null; }

  function startDay() {
    state.day = {
      date: new Date().toISOString().slice(0,10),
      operario: $('selOperario').value,
      tractor: $('selTractor').value,
      atomizador: $('selAtomizador').value,
      obs: $('txtJornadaObs').value.trim()
    };
    save('pb_day', state.day);
    showScreen('screenSelect');
  }
  function fillDayFromState() {
    if (!state.day) return;
    setSelectIfExists('selOperario', state.day.operario);
    setSelectIfExists('selTractor', state.day.tractor);
    setSelectIfExists('selAtomizador', state.day.atomizador);
    $('txtJornadaObs').value = state.day.obs || '';
  }
  function setSelectIfExists(id, value) {
    const sel = $(id); if ([...sel.options].some(o => o.value === value)) sel.value = value;
  }

  function initMap() {
    state.map = L.map('map', { zoomControl: true, tap: true });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 20,
      attribution: 'Tiles &copy; Esri'
    }).addTo(state.map);
    state.map.on('dragstart zoomstart', () => { state.follow = false; });
    drawParcels('all');
    fitAllParcels();
  }

  function drawParcels(mode='all') {
    if (!state.map) return;
    if (state.parcelLayer) state.map.removeLayer(state.parcelLayer);
    if (state.selectedLayer) state.map.removeLayer(state.selectedLayer);
    const allStyle = { color:'#f6f2e8', weight:3, opacity:1, fillColor:'#93b36f', fillOpacity:.22 };
    const mutedStyle = { color:'#f6f2e8', weight:2, opacity:.45, fillColor:'#e1d8bd', fillOpacity:.06 };
    const selectedStyle = { color:'#fff3a6', weight:5, opacity:1, fillColor:'#7db85a', fillOpacity:.30 };

    if (mode === 'all') {
      state.parcelLayer = L.geoJSON(window.PARCELAS_GEOJSON, {
        style: allStyle,
        onEachFeature: (feature, layer) => {
          const name = feature.properties.NAME || 'Parcela';
          layer.bindTooltip(name, { permanent:true, direction:'center', className:'parcel-label' });
          layer.on('click', () => selectParcel(feature));
        }
      }).addTo(state.map);
    } else if (mode === 'selected') {
      state.parcelLayer = L.geoJSON(window.PARCELAS_GEOJSON, {
        filter: f => f.properties.NAME !== state.selectedName,
        style: mutedStyle,
        interactive:false
      }).addTo(state.map);
      state.selectedLayer = L.geoJSON(state.selectedFeature, {
        style: selectedStyle,
        onEachFeature: (feature, layer) => layer.bindTooltip(feature.properties.NAME, { permanent:true, direction:'center', className:'parcel-label' })
      }).addTo(state.map);
    }
    renderParcelList();
  }

  function renderParcelList() {
    const list = $('parcelList');
    if (!list) return;
    list.innerHTML = '';
    window.PARCELAS_GEOJSON.features.forEach(f => {
      const btn = document.createElement('button');
      btn.className = 'parcel-pill';
      btn.textContent = f.properties.NAME;
      btn.type = 'button';
      btn.addEventListener('click', () => selectParcel(f));
      list.appendChild(btn);
    });
  }

  function selectParcel(feature) {
    state.selectedFeature = feature;
    state.selectedName = feature.properties.NAME;
    $('selectedParcelName').textContent = state.selectedName;
    showScreen('screenParcel');
  }

  function fitAllParcels() {
    if (!state.map || !state.parcelLayer) return;
    try { state.map.fitBounds(state.parcelLayer.getBounds(), { padding:[25,25] }); } catch(_) {}
  }
  function fitSelectedParcel() {
    if (!state.map || !state.selectedLayer) return;
    try { state.map.fitBounds(state.selectedLayer.getBounds(), { padding:[38,38] }); } catch(_) {}
  }
  function fitCurrentParcelOrAll() { state.selectedName ? fitSelectedParcel() : fitAllParcels(); }

  function showScreen(id) {
    state.screen = id;
    screens.forEach(s => $(s).classList.toggle('hidden', s !== id));
    $('btnBack').classList.toggle('hidden', id === 'screenConfig' || id === 'screenSelect');
    const mapVisible = !['screenConfig','screenHistory'].includes(id);
    $('mapCard').classList.toggle('hidden', !mapVisible);
    const subtitles = {
      screenConfig: 'Configuración de jornada',
      screenSelect: 'Seleccionar parcela',
      screenParcel: state.selectedName ? `Parcela: ${state.selectedName}` : 'Parcela seleccionada',
      screenWorkType: 'Elegir tipo de trabajo',
      screenCalibration: 'Comprobación previa del GPS',
      screenWork: 'Registro GPS de trabajo',
      screenReport: 'Informe generado',
      screenHistory: 'Consulta posterior'
    };
    $('screenSubtitle').textContent = subtitles[id] || VERSION;
    setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 120);
    if (id === 'screenSelect') { state.selectedName=null; state.selectedFeature=null; drawParcels('all'); setTimeout(fitAllParcels, 160); }
    if (['screenParcel','screenWorkType','screenCalibration','screenWork','screenReport'].includes(id) && state.selectedFeature) { drawParcels('selected'); setTimeout(fitSelectedParcel, 160); }
    if (id === 'screenWork') refreshWorkUi();
    updateBadges();
  }

  function goBack() {
    const current = state.screen;
    if (current === 'screenParcel') showScreen('screenSelect');
    else if (current === 'screenWorkType') showScreen('screenParcel');
    else if (current === 'screenCalibration') showScreen('screenWorkType');
    else if (current === 'screenWork') showScreen('screenParcel');
    else if (current === 'screenReport') showScreen('screenWork');
    else if (current === 'screenHistory') showScreen('screenReport');
    else showScreen('screenSelect');
  }

  function updateBadges() {
    const badges = [];
    if (state.day) badges.push(`Jornada: ${state.day.operario}`);
    if (state.selectedName) badges.push(state.selectedName);
    if (state.workType) badges.push(state.workType);
    if (state.currentWork) badges.push(`Estado: ${labelStatus(state.currentWork.status)}`);
    $('mapBadges').innerHTML = badges.map(b => `<div class="badge">${escapeHtml(b)}</div>`).join('');
  }

  function resetCalibration() {
    state.calibration = null;
    $('gpsPanel').className = 'gps-panel';
    $('gpsPanel').innerHTML = '<div class="gps-value">GPS: —</div><div class="gps-quality">Pendiente de comprobar</div>';
    $('gpsAdvice').className = 'notice';
    $('gpsAdvice').textContent = 'Pulsa “Comprobar GPS”.';
    $('btnEnterWork').classList.add('hidden');
    $('btnForceWork').classList.add('hidden');
    $('btnRetryGps').classList.add('hidden');
    $('btnCheckGps').classList.remove('hidden');
  }

  function checkGps() {
    $('gpsAdvice').textContent = 'Comprobando y estabilizando señal GPS…';
    $('btnCheckGps').classList.add('hidden');
    $('btnRetryGps').classList.add('hidden');
    getPosition({ timeout:15000 }).then(pos => {
      const acc = pos.coords.accuracy;
      const quality = gpsQuality(acc);
      state.calibration = {
        time: new Date().toISOString(),
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: acc,
        quality: quality.label,
        forced: false,
        device: navigator.userAgent
      };
      $('gpsPanel').innerHTML = `<div class="gps-value">GPS: ±${acc.toFixed(0)} m</div><div class="gps-quality">${quality.label}</div>`;
      $('gpsAdvice').className = `notice ${quality.ok ? 'good' : 'bad'}`;
      if (quality.ok) {
        $('gpsAdvice').textContent = 'Precisión suficiente para iniciar el registro.';
        $('btnEnterWork').classList.remove('hidden');
      } else {
        $('gpsAdvice').textContent = 'Precisión insuficiente o mala. Se recomienda esperar, recolocar el teléfono o reintentar. Puedes comenzar igualmente, quedará registrado en el informe.';
        $('btnForceWork').classList.remove('hidden');
      }
      $('btnRetryGps').classList.remove('hidden');
    }).catch(err => {
      $('gpsAdvice').className = 'notice bad';
      $('gpsAdvice').textContent = 'No se pudo leer el GPS: ' + err.message;
      $('btnRetryGps').classList.remove('hidden');
      $('btnForceWork').classList.remove('hidden');
      state.calibration = { time: new Date().toISOString(), accuracy: null, quality:'No disponible', forced:true, device:navigator.userAgent, error:err.message };
    });
  }

  function gpsQuality(acc) {
    if (acc == null) return { label:'No disponible', ok:false, level:'bad' };
    if (acc <= 5) return { label:'Buena', ok:true, level:'good' };
    if (acc <= 10) return { label:'Aceptable', ok:true, level:'ok' };
    if (acc <= 15) return { label:'Insuficiente', ok:false, level:'warn' };
    return { label:'Mala', ok:false, level:'bad' };
  }

  function enterWorkScreen() {
    state.currentWork = createEmptyWork();
    showScreen('screenWork');
  }
  function createEmptyWork() {
    return {
      id: 'trabajo_' + Date.now(),
      version: VERSION,
      parcela: state.selectedName,
      workType: state.workType,
      day: state.day,
      calibration: state.calibration,
      status: 'preparado',
      startTime: null,
      endTime: null,
      currentSegmentStart: null,
      effectiveMs: 0,
      pausedMs: 0,
      pauseStart: null,
      lastTick: null,
      rawPoints: [],
      correctedPoints: [],
      events: [],
      recargas: 0,
      paradas: 0,
      discarded: 0,
      doubtful: 0,
      distanceM: 0,
      lastValid: null,
      lastSpeedKmh: 0,
      notes: []
    };
  }

  function beginWork() {
    if (!state.currentWork) state.currentWork = createEmptyWork();
    const w = state.currentWork;
    if (w.startTime) return;
    getPosition({ timeout:12000 }).catch(() => null).then(pos => {
      const now = new Date();
      w.startTime = now.toISOString();
      w.currentSegmentStart = now.toISOString();
      w.status = 'trabajando';
      w.lastTick = Date.now();
      if (pos) {
        const p = makePoint(pos, 'comienzo');
        w.events.push({ type:'Comienzo', motive:'Comienzo', time:now.toISOString(), point:p });
        addGpsPoint(pos, 'comienzo');
        centerPoint(p);
      } else {
        w.events.push({ type:'Comienzo', motive:'Comienzo sin GPS inicial', time:now.toISOString(), point:null });
      }
      startWatch();
      startTimer();
      refreshWorkUi();
    });
  }

  function startWatch() {
    stopWatch();
    if (!navigator.geolocation) { toast('Este navegador no permite geolocalización.'); return; }
    state.watchId = navigator.geolocation.watchPosition(pos => addGpsPoint(pos, 'ruta'), err => {
      console.warn('GPS error', err);
    }, { enableHighAccuracy:true, maximumAge:1000, timeout:10000 });
  }
  function stopWatch() {
    if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  function startTimer() {
    clearInterval(state.timerId);
    state.timerId = setInterval(() => refreshWorkUi(), 1000);
  }
  function stopTimer() { clearInterval(state.timerId); state.timerId = null; }

  function makePoint(pos, source='ruta') {
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed,
      heading: pos.coords.heading,
      time: new Date(pos.timestamp || Date.now()).toISOString(),
      source,
      device: navigator.userAgent
    };
  }

  function addGpsPoint(pos, source) {
    const w = state.currentWork; if (!w) return;
    const p = makePoint(pos, source);
    const classification = classifyPoint(p, w.lastValid);
    p.classification = classification.status;
    p.reason = classification.reason;
    w.rawPoints.push(p);
    if (classification.status === 'discarded') { w.discarded += 1; return refreshRoute(); }
    if (classification.status === 'doubtful') w.doubtful += 1;
    if (w.lastValid) {
      const d = distanceM(w.lastValid, p);
      if (d > 0.7) w.distanceM += d;
      const dt = Math.max(1, (new Date(p.time) - new Date(w.lastValid.time)) / 1000);
      w.lastSpeedKmh = p.speed != null ? p.speed * 3.6 : (d / dt) * 3.6;
    }
    w.correctedPoints.push(p);
    w.lastValid = p;
    refreshRoute();
    if (state.follow && w.status === 'trabajando') centerPoint(p);
  }

  function classifyPoint(p, last) {
    if (p.accuracy != null && p.accuracy > BAD_ACCURACY_M) return { status:'discarded', reason:'Precisión > 15 m' };
    let status = 'valid', reason = '';
    if (p.accuracy != null && p.accuracy > WARN_ACCURACY_M) { status = 'doubtful'; reason = 'Precisión entre 10 y 15 m'; }
    if (last) {
      const d = distanceM(last, p);
      const dt = Math.max(1, (new Date(p.time) - new Date(last.time)) / 1000);
      const speedKmh = (d / dt) * 3.6;
      if (speedKmh > MAX_TRACTOR_SPEED_KMH) return { status:'discarded', reason:`Salto/velocidad imposible (${speedKmh.toFixed(1)} km/h)` };
    }
    return { status, reason };
  }

  function refreshRoute() {
    const w = state.currentWork; if (!w || !state.map) return;
    if (state.routeLayer) state.map.removeLayer(state.routeLayer);
    if (state.eventLayer) state.map.removeLayer(state.eventLayer);
    if (state.tractorMarker) state.map.removeLayer(state.tractorMarker);
    const latlngs = w.correctedPoints.map(p => [p.lat, p.lng]);
    if (latlngs.length >= 2) {
      state.routeLayer = L.polyline(latlngs, { color:'#1d8bd1', weight:5, opacity:.9 }).addTo(state.map);
    }
    const group = L.layerGroup();
    w.events.forEach(ev => {
      if (!ev.point) return;
      const color = ev.type === 'Comienzo' ? '#39934a' : ev.type === 'Fin' ? '#b73f34' : ev.type === 'Continuar' ? '#286aa1' : '#ba7b2c';
      const marker = L.circleMarker([ev.point.lat, ev.point.lng], { radius:9, color:'#fff', weight:3, fillColor:color, fillOpacity:1 })
        .bindPopup(`<strong>${escapeHtml(ev.type)}</strong><br>${escapeHtml(ev.motive || '')}<br>${formatTime(ev.time)}`);
      group.addLayer(marker);
    });
    group.addTo(state.map);
    state.eventLayer = group;
    const last = w.correctedPoints[w.correctedPoints.length-1];
    if (last) {
      state.tractorMarker = L.circleMarker([last.lat,last.lng], { radius:11, color:'#fff', weight:3, fillColor:'#205fbd', fillOpacity:1 }).bindPopup('Posición actual').addTo(state.map);
    }
  }

  function openStopModal() {
    showModal('Motivo de parada', `
      <div class="choice-list">
        <button class="choice modal-choice" data-stop="Recarga cisterna">Recarga cisterna</button>
        <button class="choice modal-choice" data-stop="Pausa técnica / incidencia">Pausa técnica / incidencia</button>
        <button class="choice modal-choice" data-stop="Avería / revisión">Avería / revisión</button>
        <button class="choice modal-choice" data-stop="Otro motivo">Otro motivo</button>
        <button class="choice modal-choice" data-stop="Fin de tratamiento de la parcela">Fin de tratamiento de la parcela</button>
      </div>`, [{ text:'Cancelar', className:'secondary', fn:closeModal }]);
    document.querySelectorAll('.modal-choice').forEach(btn => btn.addEventListener('click', () => handleStop(btn.dataset.stop)));
  }

  function handleStop(motive) {
    closeModal();
    const w = state.currentWork; if (!w) return;
    getPosition({ timeout:12000 }).catch(() => null).then(pos => {
      const now = new Date();
      if (pos) addGpsPoint(pos, 'evento');
      const point = pos ? makePoint(pos, 'evento') : null;
      if (motive === 'Fin de tratamiento de la parcela') {
        w.status = 'finalizado';
        w.endTime = now.toISOString();
        w.events.push({ type:'Fin', motive:'Fin de tratamiento', time:now.toISOString(), point });
        finalizeEffectiveTime();
        stopWatch(); stopTimer();
      } else {
        w.status = 'parado';
        w.pauseStart = now.toISOString();
        w.paradas += 1;
        if (motive === 'Recarga cisterna') w.recargas += 1;
        const idx = motive === 'Recarga cisterna' ? w.recargas : w.paradas;
        w.events.push({ type:'Parada', motive: `${motive}${motive === 'Recarga cisterna' ? ' ' + idx : ''}`, time:now.toISOString(), point });
        finalizeEffectiveTime();
        stopWatch();
      }
      refreshRoute(); refreshWorkUi(); updateBadges();
    });
  }

  function continueWork() {
    const w = state.currentWork; if (!w || w.status !== 'parado') return;
    getPosition({ timeout:12000 }).catch(() => null).then(pos => {
      const now = new Date();
      if (w.pauseStart) w.pausedMs += Date.now() - new Date(w.pauseStart).getTime();
      w.pauseStart = null;
      w.status = 'trabajando';
      w.currentSegmentStart = now.toISOString();
      w.lastTick = Date.now();
      if (pos) {
        addGpsPoint(pos, 'continuar');
        const p = makePoint(pos, 'continuar');
        w.events.push({ type:'Continuar', motive:'Reanudación del trabajo', time:now.toISOString(), point:p });
        centerPoint(p);
      } else {
        w.events.push({ type:'Continuar', motive:'Reanudación sin GPS', time:now.toISOString(), point:null });
      }
      startWatch(); refreshWorkUi(); updateBadges();
    });
  }

  function finalizeEffectiveTime() {
    const w = state.currentWork; if (!w || !w.currentSegmentStart) return;
    const start = new Date(w.currentSegmentStart).getTime();
    const now = Date.now();
    if (now > start) w.effectiveMs += now - start;
    w.currentSegmentStart = null;
  }

  function refreshWorkUi() {
    const w = state.currentWork; if (!w) return;
    $('workContext').textContent = `${w.parcela} · ${w.workType}`;
    $('workState').textContent = labelStatus(w.status);
    $('btnBegin').classList.toggle('hidden', w.status !== 'preparado');
    $('btnStop').classList.toggle('hidden', w.status !== 'trabajando');
    $('btnContinue').classList.toggle('hidden', w.status !== 'parado');
    $('btnReport').disabled = w.status !== 'finalizado';
    $('btnReport').classList.toggle('disabled', w.status !== 'finalizado');

    const now = Date.now();
    let totalMs = 0;
    if (w.startTime) totalMs = (w.endTime ? new Date(w.endTime).getTime() : now) - new Date(w.startTime).getTime();
    let partialMs = 0;
    if (w.status === 'trabajando' && w.currentSegmentStart) partialMs = now - new Date(w.currentSegmentStart).getTime();
    const last = w.correctedPoints[w.correctedPoints.length-1];
    $('statSpeed').textContent = `${(w.lastSpeedKmh || 0).toFixed(1).replace('.',',')} km/h`;
    $('statPartial').textContent = formatDuration(partialMs);
    $('statTotal').textContent = formatDuration(totalMs);
    $('statDistance').textContent = w.distanceM < 1000 ? `${Math.round(w.distanceM)} m` : `${(w.distanceM/1000).toFixed(2).replace('.',',')} km`;
    $('statAccuracy').textContent = last && last.accuracy != null ? `±${Math.round(last.accuracy)} m` : (w.calibration?.accuracy ? `±${Math.round(w.calibration.accuracy)} m` : '—');
    $('statReloads').textContent = w.recargas;
    const avgAcc = avg(w.rawPoints.map(p=>p.accuracy).filter(x=>typeof x === 'number'));
    const worstAcc = max(w.rawPoints.map(p=>p.accuracy).filter(x=>typeof x === 'number'));
    $('extendedStats').innerHTML = `
      <div><strong>Velocidad media</strong><br>${avgSpeed(w).toFixed(1).replace('.',',')} km/h</div>
      <div><strong>Precisión media</strong><br>${avgAcc ? '±'+avgAcc.toFixed(0)+' m' : '—'}</div>
      <div><strong>Peor precisión</strong><br>${worstAcc ? '±'+worstAcc.toFixed(0)+' m' : '—'}</div>
      <div><strong>Puntos dudosos</strong><br>${w.doubtful}</div>
      <div><strong>Puntos descartados</strong><br>${w.discarded}</div>
      <div><strong>Tiempo efectivo</strong><br>${formatDuration(computeEffectiveMs(w))}</div>
      <div><strong>Tiempo parado</strong><br>${formatDuration(computePausedMs(w))}</div>
      <div><strong>Eventos</strong><br>${w.events.length}</div>`;
  }

  function computeEffectiveMs(w) {
    let ms = w.effectiveMs || 0;
    if (w.status === 'trabajando' && w.currentSegmentStart) ms += Date.now() - new Date(w.currentSegmentStart).getTime();
    return ms;
  }
  function computePausedMs(w) {
    let ms = w.pausedMs || 0;
    if (w.status === 'parado' && w.pauseStart) ms += Date.now() - new Date(w.pauseStart).getTime();
    return ms;
  }
  function labelStatus(s) {
    return { preparado:'Preparado', trabajando:'Trabajando', parado:'Parado', finalizado:'Finalizado', cancelado:'Cancelado' }[s] || s;
  }

  function cancelWork() {
    if (!state.currentWork) return;
    if (!confirm('¿Cancelar este trabajo? Se conservará como cancelado si generas informe manualmente.')) return;
    stopWatch(); stopTimer();
    state.currentWork.status = 'cancelado';
    refreshWorkUi(); updateBadges();
  }
  function deleteWork() {
    if (!state.currentWork) return;
    if (!confirm('¿Borrar el registro actual? Esta acción elimina la ruta de esta sesión.')) return;
    stopWatch(); stopTimer();
    if (state.routeLayer) state.map.removeLayer(state.routeLayer);
    if (state.eventLayer) state.map.removeLayer(state.eventLayer);
    if (state.tractorMarker) state.map.removeLayer(state.tractorMarker);
    state.currentWork = createEmptyWork();
    refreshWorkUi(); updateBadges();
  }

  function generateReport() {
    const w = state.currentWork; if (!w || w.status !== 'finalizado') return;
    const report = buildReportObject(w);
    state.reports.unshift(report);
    save('pb_reports', state.reports.slice(0, 200));
    renderReport(report);
    showScreen('screenReport');
  }

  function buildReportObject(w) {
    const totalMs = new Date(w.endTime).getTime() - new Date(w.startTime).getTime();
    const avgAcc = avg(w.rawPoints.map(p=>p.accuracy).filter(x=>typeof x === 'number'));
    const worstAcc = max(w.rawPoints.map(p=>p.accuracy).filter(x=>typeof x === 'number'));
    return {
      id: w.id,
      createdAt: new Date().toISOString(),
      parcela: w.parcela,
      workType: w.workType,
      day: w.day,
      calibration: w.calibration,
      startTime: w.startTime,
      endTime: w.endTime,
      totalMs,
      effectiveMs: w.effectiveMs,
      pausedMs: w.pausedMs,
      distanceM: w.distanceM,
      avgSpeedKmh: avgSpeed(w),
      avgAccuracy: avgAcc,
      worstAccuracy: worstAcc,
      recargas: w.recargas,
      paradas: w.paradas,
      doubtful: w.doubtful,
      discarded: w.discarded,
      rawPoints: w.rawPoints,
      correctedPoints: w.correctedPoints,
      events: w.events,
      incidences: state.incidences.filter(i => i.parcela === w.parcela && i.createdAt >= w.startTime && i.createdAt <= w.endTime)
    };
  }

  function renderReport(r) {
    $('reportContent').innerHTML = reportHtml(r);
  }
  function reportHtml(r) {
    const gpsWarning = (r.calibration?.forced || (r.avgAccuracy && r.avgAccuracy > WARN_ACCURACY_M) || r.discarded > 0)
      ? '<div class="notice bad"><strong>Aviso GPS:</strong> El trazado contiene puntos de baja precisión o inicio forzado. Interpretar como aproximado.</div>' : '';
    return `
      <div class="report-card">
        <div class="report-title">Pazo Baion GPS</div>
        <strong>Informe de trabajo en parcela</strong><br>
        <span class="muted">${escapeHtml(r.parcela)} · ${escapeHtml(r.workType)}</span>
        ${gpsWarning}
      </div>
      <div class="report-card">
        <h3>Datos generales</h3>
        <table class="report-table">
          <tr><th>Campo</th><th>Valor</th></tr>
          <tr><td>Parcela</td><td>${escapeHtml(r.parcela)}</td></tr>
          <tr><td>Trabajo</td><td>${escapeHtml(r.workType)}</td></tr>
          <tr><td>Operario</td><td>${escapeHtml(r.day?.operario || '—')}</td></tr>
          <tr><td>Tractor</td><td>${escapeHtml(r.day?.tractor || '—')}</td></tr>
          <tr><td>Atomizador/cisterna</td><td>${escapeHtml(r.day?.atomizador || '—')}</td></tr>
          <tr><td>Inicio</td><td>${formatDateTime(r.startTime)}</td></tr>
          <tr><td>Fin</td><td>${formatDateTime(r.endTime)}</td></tr>
        </table>
      </div>
      <div class="report-card">
        <h3>Resumen operativo</h3>
        <table class="report-table">
          <tr><td>Tiempo total</td><td>${formatDuration(r.totalMs)}</td></tr>
          <tr><td>Tiempo efectivo</td><td>${formatDuration(r.effectiveMs)}</td></tr>
          <tr><td>Tiempo parado</td><td>${formatDuration(r.pausedMs)}</td></tr>
          <tr><td>Distancia recorrida</td><td>${r.distanceM < 1000 ? Math.round(r.distanceM)+' m' : (r.distanceM/1000).toFixed(2).replace('.',',')+' km'}</td></tr>
          <tr><td>Velocidad media</td><td>${r.avgSpeedKmh.toFixed(1).replace('.',',')} km/h</td></tr>
          <tr><td>Recargas</td><td>${r.recargas}</td></tr>
          <tr><td>Precisión GPS media</td><td>${r.avgAccuracy ? '±'+r.avgAccuracy.toFixed(0)+' m' : '—'}</td></tr>
          <tr><td>Peor precisión</td><td>${r.worstAccuracy ? '±'+r.worstAccuracy.toFixed(0)+' m' : '—'}</td></tr>
          <tr><td>Puntos dudosos / descartados</td><td>${r.doubtful} / ${r.discarded}</td></tr>
          <tr><td>Inicio forzado por baja precisión</td><td>${r.calibration?.forced ? 'Sí' : 'No'}</td></tr>
        </table>
      </div>
      <div class="report-card">
        <h3>Eventos registrados</h3>
        <table class="report-table"><tr><th>Hora</th><th>Evento</th><th>Motivo</th></tr>
          ${r.events.map(ev => `<tr><td>${formatTime(ev.time)}</td><td>${escapeHtml(ev.type)}</td><td>${escapeHtml(ev.motive || '')}</td></tr>`).join('')}
        </table>
      </div>
      <div class="report-card">
        <h3>Tratamiento / trabajo</h3>
        <p class="muted">Beta: aquí se vincularán productos fitosanitarios, dosis, volumen de caldo, plaga/objetivo y observaciones específicas cuando se integre el módulo de tratamientos.</p>
      </div>
      <div class="report-card">
        <h3>Incidencias</h3>
        ${r.incidences.length ? `<table class="report-table"><tr><th>Hora</th><th>Tipo</th><th>Observación</th></tr>${r.incidences.map(i => `<tr><td>${formatTime(i.createdAt)}</td><td>${escapeHtml(i.type)}</td><td>${escapeHtml(i.obs || '')}</td></tr>`).join('')}</table>` : '<p class="muted">Sin incidencias registradas durante este trabajo.</p>'}
      </div>`;
  }

  function showHistory() {
    showScreen('screenHistory');
    const list = $('historyList');
    const reports = state.reports || [];
    if (!reports.length) { list.innerHTML = '<div class="notice">No hay informes guardados en este dispositivo.</div>'; return; }
    list.innerHTML = reports.map((r, idx) => `
      <div class="history-item">
        <strong>${escapeHtml(r.parcela)}</strong><br>
        ${escapeHtml(r.workType)} · ${formatDateTime(r.startTime)}<br>
        Duración: ${formatDuration(r.totalMs)} · Recargas: ${r.recargas}<br>
        <button class="secondary open-report" data-idx="${idx}" type="button">Ver informe</button>
      </div>`).join('');
    document.querySelectorAll('.open-report').forEach(btn => btn.addEventListener('click', () => {
      const r = state.reports[Number(btn.dataset.idx)]; renderReport(r); showScreen('screenReport');
    }));
  }

  function openIncidentModal() {
    if (!state.selectedName) return;
    showModal('Señalizar incidencia', `
      <label>Tipo
        <select id="incType">
          <option>Poste roto</option><option>Alambre roto</option><option>Cepa muerta</option><option>Marra / falta de planta</option><option>Daño en emparrado</option><option>Otra</option>
        </select>
      </label>
      <label>Observación<textarea id="incObs" rows="3" placeholder="Opcional"></textarea></label>`, [
        { text:'Guardar punto GPS', className:'primary', fn:saveIncident },
        { text:'Cancelar', className:'secondary', fn:closeModal }
      ]);
  }
  function saveIncident() {
    const type = $('incType').value; const obs = $('incObs').value.trim();
    getPosition({ timeout:12000 }).catch(() => null).then(pos => {
      const point = pos ? makePoint(pos, 'incidencia') : null;
      const incidence = { id:'inc_'+Date.now(), parcela: state.selectedName, type, obs, point, createdAt:new Date().toISOString(), status:'pendiente' };
      state.incidences.unshift(incidence); save('pb_incidences', state.incidences);
      closeModal(); toast('Incidencia guardada.');
    });
  }

  function showModal(title, bodyHtml, actions=[]) {
    $('modalTitle').textContent = title; $('modalBody').innerHTML = bodyHtml; $('modalActions').innerHTML = '';
    actions.forEach(a => { const btn=document.createElement('button'); btn.type='button'; btn.className=a.className || 'secondary'; btn.textContent=a.text; btn.addEventListener('click', a.fn); $('modalActions').appendChild(btn); });
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  function getPosition(opts={}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) reject(new Error('Geolocalización no disponible'));
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy:true, maximumAge:0, timeout:opts.timeout || 10000 });
    });
  }

  function centerPoint(p) { if (state.map && p) state.map.setView([p.lat,p.lng], Math.max(state.map.getZoom(), 18)); }
  function centerOnTractor() {
    const w = state.currentWork; const last = w?.correctedPoints?.[w.correctedPoints.length-1];
    if (last) centerPoint(last); else fitCurrentParcelOrAll();
  }
  function avgSpeed(w) {
    const hours = Math.max(0.0001, (computeEffectiveMs(w) || w.effectiveMs || 1) / 3600000);
    return (w.distanceM / 1000) / hours;
  }
  function distanceM(a,b) {
    const R=6371000, toRad=x=>x*Math.PI/180;
    const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
    const lat1=toRad(a.lat), lat2=toRad(b.lat);
    const h=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
  }
  function avg(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }
  function max(arr){ return arr.length ? Math.max(...arr) : null; }
  function formatDuration(ms) {
    ms = Math.max(0, Math.floor(ms/1000));
    const h = Math.floor(ms/3600), m = Math.floor((ms%3600)/60), s = ms%60;
    return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
  }
  function formatDateTime(iso) { if (!iso) return '—'; return new Date(iso).toLocaleString('es-ES', { dateStyle:'short', timeStyle:'short' }); }
  function formatTime(iso) { if (!iso) return '—'; return new Date(iso).toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
  function escapeHtml(str) { return String(str ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function toast(msg) { alert(msg); }

  function shareReport() {
    const txt = document.querySelector('#reportContent')?.innerText?.slice(0, 2000) || 'Informe Pazo Baion GPS';
    if (navigator.share) navigator.share({ title:'Informe Pazo Baion GPS', text:txt }).catch(()=>{});
    else { navigator.clipboard?.writeText(txt); toast('Resumen copiado al portapapeles.'); }
  }
  function exportJson() {
    const r = state.reports[0] || buildReportObject(state.currentWork);
    downloadFile(`${safeFile(r.parcela)}_${safeFile(r.workType)}.json`, JSON.stringify(r,null,2), 'application/json');
  }
  function exportCsv() {
    const r = state.reports[0] || buildReportObject(state.currentWork);
    const rows = [['hora','evento','motivo','lat','lng','precision_m']];
    r.events.forEach(ev => rows.push([formatTime(ev.time), ev.type, ev.motive || '', ev.point?.lat || '', ev.point?.lng || '', ev.point?.accuracy || '']));
    const csv = rows.map(row => row.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\n');
    downloadFile(`${safeFile(r.parcela)}_${safeFile(r.workType)}_eventos.csv`, csv, 'text/csv;charset=utf-8');
  }
  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type }); const a=document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  function safeFile(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'_').replace(/^_|_$/g,''); }
})();
