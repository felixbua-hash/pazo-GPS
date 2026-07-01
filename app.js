(() => {
  "use strict";

  const VERSION = "Beta 1.10 reconstruida desde Beta 1.2";
  const LS = {
    map: "pbgps_parcel_geojson_v08",
    incidentLayer: "pbgps_incident_layer_geojson_v08",
    lists: "pbgps_lists_v08",
    day: "pbgps_day_config_v08",
    history: "pbgps_history_v08",
    incidents: "pbgps_incidents_v08",
    active: "pbgps_active_work_v08"
  };

  const state = {
    parcelsGeoJSON: null,
    incidentsGeoJSON: null,
    selectedFeature: null,
    selectedParcelName: "",
    workType: "",
    dayConfig: null,
    maps: {},
    layers: {},
    watchId: null,
    currentPos: null,
    gpsCalibration: null,
    work: null,
    reportMapReady: false,
    trackingFollow: true,
    reportWork: null,
    reportOrigin: "work",
    tickerStarted: false,
    historyFilter: "all"
  };

  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  const storage = {
    get(key, fallback=null){
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value){ localStorage.setItem(key, JSON.stringify(value)); },
    remove(key){ localStorage.removeItem(key); }
  };

  function setAppHeight(){
    document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
  }

  function afterLayoutStable(fn){
    // iPhone/Safari necesita que la pantalla activa tenga tamaño real antes de crear Leaflet.
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(fn, 40)));
  }

  function show(screenId){
    setAppHeight();
    qsa(".screen").forEach(s => s.classList.remove("active"));
    const screen = $(screenId);
    screen.classList.add("active");
    afterLayoutStable(() => {
      if(screenId === "screen-parcel-select") setupAllMap();
      if(screenId === "screen-parcel-detail") setupParcelMap();
      if(screenId === "screen-work") setupWorkMap();
      if(screenId === "screen-report") renderReport();
      if(screenId === "screen-history") renderHistory();
    });
  }

  function toast(msg){ alert(msg); }

  function formatMeters(m){
    if(m === null || m === undefined || !isFinite(m)) return "—";
    return "±" + Math.round(m) + " m";
  }
  function gpsClass(acc){
    if(!isFinite(acc)) return {label:"Sin datos", cls:"muted"};
    if(acc <= 5) return {label:"Buena", cls:"good"};
    if(acc <= 10) return {label:"Aceptable", cls:"accept"};
    if(acc <= 15) return {label:"Insuficiente", cls:"warn"};
    return {label:"Mala", cls:"bad"};
  }
  function fmtTime(ms){
    if(!isFinite(ms) || ms < 0) ms = 0;
    const total = Math.floor(ms/1000);
    const h = Math.floor(total/3600);
    const m = Math.floor((total%3600)/60);
    const s = total%60;
    if(h>0) return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function fmtDurationCompact(ms){
    if(!isFinite(ms) || ms < 0) ms = 0;
    const totalMinutes = Math.round(ms / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }

  function formatMetersDetailed(m){
    if(m === null || m === undefined || !isFinite(m)) return "—";
    return `±${Number(m).toFixed(1).replace(".", ",")} m`;
  }
  function haversine(a,b){
    if(!a || !b) return 0;
    const R=6371000, toRad=d=>d*Math.PI/180;
    const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
    const lat1=toRad(a.lat), lat2=toRad(b.lat);
    const x=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }

  function isFeatureCollection(gj){
    return gj && gj.type === "FeatureCollection" && Array.isArray(gj.features);
  }

  function isValidParcelsGeoJSON(gj){
    return isFeatureCollection(gj) &&
      gj.features.some(f => f.geometry && ["Polygon","MultiPolygon"].includes(f.geometry.type));
  }

  function isValidIncidentsGeoJSON(gj){
    // La capa de incidencias puede estar vacía o contener puntos, líneas o polígonos.
    return isFeatureCollection(gj);
  }

  // Compatibilidad interna con versiones anteriores del código.
  function isValidGeoJSON(gj){
    return isValidParcelsGeoJSON(gj);
  }

  function featureName(f){
    return f?.properties?.NAME || f?.properties?.name || f?.properties?.Nombre || f?.properties?.nombre || "Parcela sin nombre";
  }

  function getBoundsFromGeoJSON(gj){
    const coords=[];
    const walk = (c) => {
      if(typeof c?.[0] === "number" && isFinite(c[0]) && isFinite(c[1])) coords.push([c[1], c[0]]);
      else if(Array.isArray(c)) c.forEach(walk);
    };
    if(gj?.type === "Feature") walk(gj.geometry?.coordinates);
    else if(Array.isArray(gj?.features)) gj.features.forEach(f => walk(f.geometry?.coordinates));
    return coords.length ? L.latLngBounds(coords) : null;
  }

  function saveParcelsLayer(gj){
    state.parcelsGeoJSON = gj;
    storage.set(LS.map, gj);
    renderParcelPreview(gj);
    updateContinueAvailability();
  }

  // Compatibilidad con nombre anterior.
  function saveMap(gj){ saveParcelsLayer(gj); }

  function saveIncidentsLayer(gj){
    state.incidentsGeoJSON = gj;
    storage.set(LS.incidentLayer, gj);
    renderIncidentLayerStatus(gj);
  }

  function updateContinueAvailability(){
    $("continueAfterMap").disabled = !isValidParcelsGeoJSON(state.parcelsGeoJSON);
  }

  function renderParcelPreview(gj){
    const polygons = gj.features.filter(f => f.geometry && ["Polygon","MultiPolygon"].includes(f.geometry.type));
    const names = polygons.map(featureName);
    $("parcelListPreview").innerHTML = "";
    $("parcelListPreview").classList.add("hidden");
    $("mapLoadStatus").className = "status-card ok";
    $("mapLoadStatus").innerHTML = `<strong>PARCELAS.geojson cargado.</strong><br>${names.length} parcelas detectadas.`;
    updateContinueAvailability();
  }

  function renderIncidentLayerStatus(gj){
    const count = Array.isArray(gj?.features) ? gj.features.length : 0;
    $("incidentLayerStatus").className = "status-card ok";
    $("incidentLayerStatus").innerHTML = `<strong>INCIDENCIAS_.geojson cargado.</strong><br>${count} incidencias importadas${count === 0 ? " (capa vacía)" : ""}.`;
  }

  function escapeHtml(s){
    return String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  function initLists(){
    const defaults = window.PAZO_BAION_DEFAULTS;
    const lists = storage.get(LS.lists, null) || {
      operators: defaults.operators,
      tractors: defaults.tractors,
      sprayers: defaults.sprayers,
      incidentTypes: defaults.incidentTypes
    };
    storage.set(LS.lists, lists);
    fillSelect("operatorSelect", lists.operators);
    fillSelect("tractorSelect", lists.tractors);
    fillSelect("sprayerSelect", lists.sprayers);
    fillSelect("incidentType", lists.incidentTypes);
  }

  function fillSelect(id, arr){
    const el = $(id);
    el.innerHTML = arr.map(v => `<option>${escapeHtml(v)}</option>`).join("");
  }

  const listSelectId = { operators:"operatorSelect", tractors:"tractorSelect", sprayers:"sprayerSelect" };
  const listLabel = { operators:"operario", tractors:"tractor", sprayers:"atomizador/cisterna" };

  function normalizeListValue(value){
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function addToList(key){
    const label = listLabel[key] || "elemento";
    const value = normalizeListValue(prompt(`Nuevo ${label}:`));
    if(!value) return;
    const lists = storage.get(LS.lists, {});
    lists[key] = Array.from(new Set([...(lists[key]||[]), value].filter(Boolean)));
    storage.set(LS.lists, lists);
    initLists();
    const selectId = listSelectId[key];
    if(selectId) $(selectId).value = value;
  }

  function editListItem(key){
    const selectId = listSelectId[key];
    const select = selectId ? $(selectId) : null;
    const current = select?.value || "";
    const label = listLabel[key] || "elemento";
    if(!current){ toast(`No hay ${label} seleccionado para editar.`); return; }
    const value = normalizeListValue(prompt(`Editar ${label}:`, current));
    if(!value || value === current) return;
    const lists = storage.get(LS.lists, {});
    const arr = lists[key] || [];
    lists[key] = Array.from(new Set(arr.map(v => v === current ? value : v).filter(Boolean)));
    storage.set(LS.lists, lists);
    initLists();
    if(selectId) $(selectId).value = value;
  }

  function deleteListItem(key){
    const selectId = listSelectId[key];
    const select = selectId ? $(selectId) : null;
    const current = select?.value || "";
    const label = listLabel[key] || "elemento";
    if(!current){ toast(`No hay ${label} seleccionado para eliminar.`); return; }
    if(!confirm(`¿Eliminar “${current}” de la lista de ${label}s?`)) return;
    const lists = storage.get(LS.lists, {});
    lists[key] = (lists[key] || []).filter(v => v !== current);
    storage.set(LS.lists, lists);
    initLists();
  }

  function todayIso(){
    return new Date().toISOString().slice(0,10);
  }

  function loadSavedDayConfig(){
    const day = storage.get(LS.day, null);
    if(day){
      $("operatorSelect").value = day.operator || $("operatorSelect").value;
      $("tractorSelect").value = day.tractor || $("tractorSelect").value;
      $("sprayerSelect").value = day.sprayer || $("sprayerSelect").value;
      $("dayNotes").value = day.notes || "";
      state.dayConfig = day;
      if(day.date && day.date !== todayIso()){
        $("dayStatus").className = "status-card warn";
        $("dayStatus").innerHTML = `<strong>Jornada anterior detectada.</strong><br>La configuración guardada es del ${escapeHtml(day.date)}. Revísala y pulsa Comenzar jornada para usarla hoy.`;
      } else {
        $("dayStatus").className = "status-card ok";
        $("dayStatus").textContent = "Jornada activa para hoy.";
      }
    } else {
      $("dayStatus").className = "status-card muted";
      $("dayStatus").textContent = "Introduce o confirma la configuración de la jornada.";
    }
  }

  function saveDayConfig(){
    const cfg = {
      date: todayIso(),
      operator: $("operatorSelect").value,
      tractor: $("tractorSelect").value,
      sprayer: $("sprayerSelect").value,
      notes: $("dayNotes").value.trim()
    };
    state.dayConfig = cfg;
    storage.set(LS.day, cfg);
    show("screen-parcel-select");
  }

  function ensureLeaflet(){
    if(!window.L){
      toast("No se pudo cargar el mapa. Revisa la conexión a internet.");
      return false;
    }
    return true;
  }

  function destroyMap(key, id){
    const existing = state.maps[key];
    if(existing){
      try { existing.off(); existing.remove(); } catch(err) { console.warn("No se pudo destruir mapa", key, err); }
      state.maps[key] = null;
    }
    const el = $(id);
    if(el){
      el.innerHTML = "";
      // Leaflet bloquea reutilizar un contenedor con _leaflet_id. Se limpia de forma explícita.
      try { delete el._leaflet_id; } catch {}
    }
  }

  function containerReady(id){
    const el = $(id);
    if(!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 120 && r.height > 120;
  }

  function makeMap(id, key, options={}){
    if(!ensureLeaflet()) return null;
    setAppHeight();
    destroyMap(key, id);
    const el = $(id);
    if(!el || !containerReady(id)){
      console.warn(`Contenedor de mapa sin tamaño estable: ${id}`);
    }
    const map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      trackResize: false,
      preferCanvas: true,
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
      inertia: true,
      ...options
    });
    const tile = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 20,
      attribution: "Tiles © Esri",
      keepBuffer: 6,
      updateWhenIdle: false,
      updateWhenZooming: false,
      crossOrigin: false
    }).addTo(map);
    map._pbgpsTile = tile;
    state.maps[key] = map;
    return map;
  }

  function stabilizeMap(map, bounds=null, padding=[25,25]){
    if(!map) return;
    const apply = (withFit=true) => {
      try{
        setAppHeight();
        map.invalidateSize({pan:false, debounceMoveend:false});
        if(withFit && bounds && bounds.isValid && bounds.isValid()) {
          map.fitBounds(bounds, { padding, animate:false, maxZoom: 19 });
        }
        if(map._pbgpsTile) map._pbgpsTile.redraw();
      }catch(err){ console.warn("Ajuste de mapa", err); }
    };
    apply(true);
    requestAnimationFrame(() => apply(true));
    requestAnimationFrame(() => requestAnimationFrame(() => apply(true)));
    [120, 300, 700, 1200].forEach((ms, i) => setTimeout(() => apply(i < 2), ms));
  }

  function waitForMapContainer(id, callback, tries=0){
    if(containerReady(id) || tries > 20){ callback(); return; }
    setTimeout(() => waitForMapContainer(id, callback, tries + 1), 50);
  }

  function parcelStyle(selected=false){
    return {
      color: selected ? "#fff4c7" : "#f4ecd1",
      weight: selected ? 4 : 3,
      opacity: 1,
      fillColor: selected ? "#8b8758" : "#25563a",
      fillOpacity: selected ? 0.34 : 0.18
    };
  }

  function incidentFeatureLabel(feature){
    const p = feature?.properties || {};
    return p.NAME || p.Name || p.name || p.NOMBRE || p.tipo || p.Tipo || p.TYPE || "Incidencia";
  }

  function importedIncidentStyle(){
    return { color: "#a8483a", weight: 3, opacity: .95, fillColor: "#a8483a", fillOpacity: .28 };
  }

  function drawImportedIncidents(map, key){
    if(!map || !state.incidentsGeoJSON) return;
    const layerKey = key || "importedIncidents";
    if(state.layers[layerKey]) state.layers[layerKey].remove();
    if(!isValidIncidentsGeoJSON(state.incidentsGeoJSON)) return;
    state.layers[layerKey] = L.geoJSON(state.incidentsGeoJSON, {
      style: importedIncidentStyle,
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#a8483a",
        fillOpacity: 1
      }),
      onEachFeature: (feature, layer) => {
        const label = incidentFeatureLabel(feature);
        layer.bindTooltip(label, { permanent:false, direction:"top", className:"imported-incident-label" });
      }
    }).addTo(map);
  }

  function setupAllMap(){
    if(!state.parcelsGeoJSON) return;
    waitForMapContainer("mapAll", () => {
      const map = makeMap("mapAll", "all");
      if(!map) return;
      state.layers.all = L.geoJSON(state.parcelsGeoJSON, {
        filter: feature => feature.geometry && ["Polygon","MultiPolygon"].includes(feature.geometry.type),
        style: parcelStyle(false),
        interactive: true,
        onEachFeature: (feature, layer) => {
          const name = featureName(feature);
          layer.bindTooltip(name, { permanent: true, direction: "center", className: "parcel-label" });
          layer.on("click", () => selectParcel(feature));
        }
      }).addTo(map).bringToFront();
      drawImportedIncidents(map, "allImportedIncidents");
      if(state.layers.allImportedIncidents) state.layers.allImportedIncidents.bringToFront();
      const bounds = state.layers.all.getBounds && state.layers.all.getBounds().isValid() ? state.layers.all.getBounds() : getBoundsFromGeoJSON(state.parcelsGeoJSON);
      if(bounds) stabilizeMap(map, bounds, [34,34]);
      $("parcelSelectInfo").textContent = "Mapa cargado. Selecciona una parcela.";
    });
  }

  function selectParcel(feature){
    state.selectedFeature = feature;
    state.selectedParcelName = featureName(feature);
    $("selectedParcelName").textContent = state.selectedParcelName;
    $("workTypeParcel").textContent = state.selectedParcelName;
    show("screen-parcel-detail");
  }

  function setupParcelMap(){
    if(!state.selectedFeature) return;
    waitForMapContainer("mapParcel", () => {
      const map = makeMap("mapParcel", "parcel");
      if(!map) return;
      state.layers.parcelAll = L.geoJSON(state.parcelsGeoJSON, {
        filter: feature => feature.geometry && ["Polygon","MultiPolygon"].includes(feature.geometry.type),
        style: { color:"#ffffff", weight:1, fillOpacity:.06, opacity:.35 }
      }).addTo(map);
      state.layers.parcelSelected = L.geoJSON(state.selectedFeature, { style: parcelStyle(true) }).addTo(map).bringToFront();
      state.layers.parcelSelected.bindTooltip(state.selectedParcelName, { permanent:true, direction:"center", className:"parcel-label selected" });
      drawImportedIncidents(map, "parcelImportedIncidents");
      drawParcelIncidentMarkers(map);
      const b = state.layers.parcelSelected.getBounds();
      if(b && b.isValid()) stabilizeMap(map, b, [42,42]);
    });
  }

  function drawParcelIncidentMarkers(map){
    if(state.layers.parcelIncidents) state.layers.parcelIncidents.remove();
    state.layers.parcelIncidents = L.layerGroup().addTo(map);
    const incidents = storage.get(LS.incidents, []).filter(i => i.parcel === state.selectedParcelName && i.lat && i.lng);
    incidents.forEach(inc => {
      L.circleMarker([inc.lat, inc.lng], {
        radius: 8, color: "#fff", weight: 2, fillColor: getIncidentColor(inc.type), fillOpacity: 1
      }).bindTooltip(`${inc.type} · ${inc.status}`, { permanent:false }).addTo(state.layers.parcelIncidents);
    });
  }

  function chooseWorkType(type){
    state.workType = type;
    $("workHeader").textContent = `${state.selectedParcelName} · ${state.workType}`;
    show("screen-gps-calibration");
  }

  async function runGpsCalibration(){
    const samples = [];
    $("gpsQualityText").className = "status-card muted";
    $("gpsQualityText").textContent = "Tomando muestras GPS durante unos segundos...";
    $("runGpsCalibration").disabled = true;
    $("startAfterCalibration").disabled = true;
    $("forceStartWork").classList.add("hidden");
    $("gpsSamples").textContent = "0";
    $("gpsBest").textContent = "—";
    $("gpsAvg").textContent = "—";
    $("gpsAccuracyValue").textContent = "—";

    if(!navigator.geolocation){
      $("gpsQualityText").className = "status-card bad";
      $("gpsQualityText").textContent = "Este navegador no permite geolocalización.";
      $("runGpsCalibration").disabled = false;
      return;
    }

    const endAt = Date.now() + 10000;
    let stop = false;
    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 7000 };

    const collect = () => new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(pos => resolve(pos), err => resolve({error: err}), options);
    });

    while(Date.now() < endAt && !stop){
      const pos = await collect();
      if(pos && !pos.error){
        const acc = pos.coords.accuracy;
        samples.push({ 
          lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc, 
          speed: pos.coords.speed, time: pos.timestamp 
        });
        const best = Math.min(...samples.map(s => s.accuracy));
        const avg = samples.reduce((a,s)=>a+s.accuracy,0)/samples.length;
        $("gpsSamples").textContent = String(samples.length);
        $("gpsBest").textContent = formatMeters(best);
        $("gpsAvg").textContent = formatMeters(avg);
        $("gpsAccuracyValue").textContent = formatMeters(acc);
      }
      await new Promise(r => setTimeout(r, 900));
    }

    const last = samples.at(-1);
    const best = samples.length ? Math.min(...samples.map(s=>s.accuracy)) : Infinity;
    const avg = samples.length ? samples.reduce((a,s)=>a+s.accuracy,0)/samples.length : Infinity;
    const cls = gpsClass(best);
    state.gpsCalibration = { samples: samples.length, best, avg, last, quality: cls.label, forced: false, at: new Date().toISOString() };

    const dial = $("gpsQualityDial");
    dial.className = "gps-dial " + cls.cls;
    $("gpsQualityText").className = "status-card " + (["good","accept"].includes(cls.cls) ? "ok" : cls.cls === "warn" ? "warn" : "bad");
    $("gpsQualityText").innerHTML = `<strong>GPS ${cls.label}</strong><br>Mejor precisión: ${formatMeters(best)} · Media: ${formatMeters(avg)}`;

    if(["Buena","Aceptable"].includes(cls.label)){
      $("startAfterCalibration").disabled = false;
      $("forceStartWork").classList.add("hidden");
    } else {
      $("startAfterCalibration").disabled = true;
      $("forceStartWork").classList.remove("hidden");
    }
    $("runGpsCalibration").disabled = false;
  }

  function startWorkShell(forced=false){
    if(!state.gpsCalibration) state.gpsCalibration = {samples:0, best:Infinity, avg:Infinity, quality:"No comprobado", forced, at:new Date().toISOString()};
    state.gpsCalibration.forced = forced;

    state.work = {
      id: "trabajo-" + Date.now(),
      createdAt: Date.now(),
      parcel: state.selectedParcelName,
      parcelFeature: state.selectedFeature,
      type: state.workType,
      day: state.dayConfig || storage.get(LS.day, {}),
      status: "preparado",
      startedAt: null,
      finishedAt: null,
      lastSegmentAt: null,
      pausedAt: null,
      stoppedMs: 0,
      activeMs: 0,
      distanceM: 0,
      refills: 0,
      stops: 0,
      gpsCalibration: state.gpsCalibration,
      pointsOriginal: [],
      pointsClean: [],
      events: [],
      incidents: [],
      gpsStats: { bad:0, doubtful:0, discarded:0, best:Infinity, worst:0, sum:0, count:0 },
      windReadings: [],
      nextWindPromptAt: null,
      sessions: [],
      currentSessionId: null,
      forcedStart: forced
    };
    storage.set(LS.active, state.work);
    state.reportWork = null;
    state.reportOrigin = "work";
    resetLiveUi();
    show("screen-work");
  }

  function setupWorkMap(){
    if(!state.work) return;
    waitForMapContainer("mapWork", () => {
      const map = makeMap("mapWork", "work");
      if(!map) return;
      const feature = state.selectedFeature || state.work.parcelFeature || findParcelFeatureByName(state.work.parcel);
      if(feature) state.layers.workParcel = L.geoJSON(feature, { style: parcelStyle(true) }).addTo(map).bringToFront();
      drawImportedIncidents(map, "workImportedIncidents");
      const b = state.layers.workParcel?.getBounds ? state.layers.workParcel.getBounds() : null;
      if(b.isValid()) stabilizeMap(map, b, [42,42]);
      updateRouteLayers();
    });
  }

  function setWorkStateUi(label){
    const icon = $("workStateIcon");
    $("workStateLabel").textContent = label;
    if(!icon) return;
    icon.className = "metric-icon state-icon";
    if(label === "Trabajando"){
      icon.textContent = "▶";
      icon.classList.add("is-working");
    }else if(label === "Parado"){
      icon.textContent = "■";
      icon.classList.add("is-paused");
    }else if(label === "Finalizado"){
      icon.textContent = "■";
      icon.classList.add("is-ended");
    }else{
      icon.textContent = "○";
    }
  }

  function resetLiveUi(){
    $("beginWorkBtn").classList.remove("hidden");
    $("stopWorkBtn").classList.add("hidden");
    $("continueWorkBtn").classList.add("hidden");
    setWorkStateUi("Preparado");
    $("liveSpeed").textContent = "0,0";
    $("partialTime").textContent = "00:00";
    $("totalTime").textContent = "00:00";
    $("distanceKm").textContent = "0,00";
    $("liveAccuracy").textContent = "—";
    $("refillCount").textContent = "0";
    updateWindUi();
  }

  function ensureSessions(w){
    if(!w.sessions) w.sessions = [];
    return w.sessions;
  }

  function startWorkSession(w, at=Date.now(), notes=""){
    const sessions = ensureSessions(w);
    const id = "sesion-" + at + "-" + (sessions.length + 1);
    const d = new Date(at);
    sessions.push({
      id,
      date: d.toISOString().slice(0,10),
      startAt: at,
      startedAt: at,
      endAt: null,
      finishedAt: null,
      activeMs: 0,
      notes
    });
    w.currentSessionId = id;
    return id;
  }

  function closeCurrentSession(w, at=Date.now(), notes=""){
    const sessions = ensureSessions(w);
    const session = sessions.find(s => s.id === w.currentSessionId) || sessions.find(s => !s.endAt);
    if(!session || session.endAt) return;
    const base = w.lastSegmentAt || session.startAt || at;
    session.activeMs = Math.max(0, (session.activeMs || 0) + (at - base));
    session.endAt = at;
    session.finishedAt = at;
    if(notes) session.notes = session.notes ? `${session.notes}; ${notes}` : notes;
    w.currentSessionId = null;
  }

  function derivedSessions(w){
    const sessions = ensureSessions(w).slice().sort((a,b)=>(a.startAt||a.startedAt||0)-(b.startAt||b.startedAt||0));
    if(sessions.length) return sessions;
    if(w.startedAt){
      return [{id:"sesion-derivada", date:new Date(w.startedAt).toISOString().slice(0,10), startAt:w.startedAt, startedAt:w.startedAt, endAt:w.finishedAt || null, finishedAt:w.finishedAt || null, activeMs:reportEffectiveActiveMs(w), notes:"Sesión reconstruida desde el registro principal."}];
    }
    return [];
  }

  function sessionRows(w){
    const sessions = derivedSessions(w);
    return sessions.map((session, idx) => {
      const start = session.startAt || session.startedAt || null;
      const end = session.endAt || session.finishedAt || null;
      const stopped = start && end ? Math.max(0, (end - start) - (session.activeMs || 0)) : 0;
      return {
        ...session,
        index: idx + 1,
        start,
        end,
        stoppedMs: stopped
      };
    });
  }

  function beginWork(){
    if(!state.work) return;
    const now = Date.now();
    state.work.status = "trabajando";
    state.work.startedAt = state.work.startedAt || now;
    state.work.lastSegmentAt = now;
    state.work.pausedAt = null;
    if(isPhytosanitaryWork(state.work)) state.work.nextWindPromptAt = now + 30*60*1000;
    else { state.work.nextWindPromptAt = null; state.work.windReadings = []; }
    startWorkSession(state.work, now, "Inicio del trabajo");
    addEvent("Comienzo", "Punto inicial", "Inicio del trabajo");
    $("beginWorkBtn").classList.add("hidden");
    $("stopWorkBtn").classList.remove("hidden");
    $("continueWorkBtn").classList.add("hidden");
    setWorkStateUi("Trabajando");
    updateWindUi();
    state.trackingFollow = true;
    startGpsWatch();
    centerWorkMapOnTractor(true);
    if(isPhytosanitaryWork(state.work)) setTimeout(() => promptWindReading(false, "Registrar viento previsto inicial"), 600);
    if(!state.tickerStarted){
      state.tickerStarted = true;
      tick();
    }
  }

  function startGpsWatch(){
    if(!navigator.geolocation){
      toast("GPS no disponible en este navegador.");
      return;
    }
    if(state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = navigator.geolocation.watchPosition(onPosition, onGpsError, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 10000
    });
  }
  function stopGpsWatch(){
    if(state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  async function centerWorkMapOnTractor(forceFresh=false){
    const map = state.maps.work;
    if(!map) return;
    let p = state.currentPos;
    if(forceFresh || !freshPosition(p)){
      try{
        p = await getCurrentGpsPosition();
        state.currentPos = p;
        drawCurrentPosition(p);
      }catch(err){
        return;
      }
    }
    if(p && isFinite(p.lat) && isFinite(p.lng)){
      map.setView([p.lat, p.lng], Math.max(map.getZoom() || 0, 19), { animate:true });
    }
  }

  function isPhytosanitaryWork(w=state.work){
    const type = String(w?.type || state.workType || "").toLowerCase();
    return type.includes("fitosanit");
  }

  function formatWind(kmh){
    if(kmh === null || kmh === undefined || !isFinite(kmh)) return "—";
    const n = Number(kmh);
    return `${n.toFixed(n >= 10 ? 0 : 1).replace(".", ",")} km/h`;
  }

  function windLevel(kmh){
    const n = Number(kmh);
    if(!isFinite(n)) return {label:"Sin datos", cls:"muted", dot:"•", color:"#706b5a", detail:"Sin dato de viento previsto."};
    if(n <= 10.8) return {label:"Verde", cls:"good", dot:"●", color:"#2f7d44", detail:"Viento previsto dentro del rango recomendado."};
    if(n <= 15.3) return {label:"Ámbar", cls:"warn", dot:"●", color:"#c47b32", detail:"Viento previsto en zona de precaución."};
    return {label:"Rojo", cls:"bad", dot:"●", color:"#a8483a", detail:"Viento previsto por encima del umbral fijado."};
  }

  function normalizeWindDirection(dir){
    const v = String(dir || "").trim().toUpperCase().replace(/\s+/g, "");
    const aliases = {NORTE:"N", SUR:"S", ESTE:"E", OESTE:"O", W:"O", NW:"NO", SW:"SO"};
    return aliases[v] || v || "—";
  }

  function directionToDegrees(dir){
    const d = normalizeWindDirection(dir);
    return ({N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5, S:180, SSO:202.5, SO:225, OSO:247.5, O:270, ONO:292.5, NO:315, NNO:337.5})[d] ?? 45;
  }

  function windStats(readings){
    const arr = (readings || []).map(r => Number(r.kmh)).filter(v => isFinite(v));
    const gusts = (readings || []).map(r => Number(r.gustKmh)).filter(v => isFinite(v));
    const dirs = (readings || []).map(r => normalizeWindDirection(r.direction)).filter(v => v && v !== "—");
    const dirCounts = dirs.reduce((acc,d)=>(acc[d]=(acc[d]||0)+1, acc), {});
    const predominantDirection = Object.entries(dirCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || "—";
    if(!arr.length) return { latest:null, avg:null, max:null, gustMax:gusts.length ? Math.max(...gusts) : null, count:0, predominantDirection, global:windLevel(null) };
    const max = Math.max(...arr);
    return {
      latest: arr[arr.length-1],
      avg: arr.reduce((a,b)=>a+b,0)/arr.length,
      max,
      gustMax: gusts.length ? Math.max(...gusts) : null,
      count: arr.length,
      predominantDirection,
      global: windLevel(max)
    };
  }

  function getWindReferencePoint(){
    const p = state.currentPos || state.gpsCalibration?.last || null;
    if(p && isFinite(p.lat) && isFinite(p.lng)) return {lat:p.lat, lng:p.lng, accuracy:p.accuracy || null, origin:"GPS del dispositivo"};
    const feature = state.selectedFeature || state.work?.parcelFeature || findParcelFeatureByName(state.work?.parcel);
    const b = feature ? getBoundsFromGeoJSON({type:"FeatureCollection", features:[feature]}) : null;
    if(b && b.isValid && b.isValid()){
      const c = b.getCenter();
      return {lat:c.lat, lng:c.lng, accuracy:null, origin:"centro aproximado de la parcela"};
    }
    return {lat:null, lng:null, accuracy:null, origin:"sin referencia GPS disponible"};
  }

  function formatReferencePoint(ref){
    if(!ref || !isFinite(ref.lat) || !isFinite(ref.lng)) return ref?.origin || "sin referencia GPS disponible";
    return `${ref.lat.toFixed(6)}, ${ref.lng.toFixed(6)} · ${ref.origin || "referencia"}`;
  }

  function updateWindUi(){
    const card = $("windReadingBtn");
    const el = $("windSpeedValue");
    const active = isPhytosanitaryWork();
    if(card){
      card.classList.toggle("hidden", !active);
      card.closest(".work-stats-secondary")?.classList.toggle("no-wind", !active);
    }
    if(!el) return;
    if(!active){ el.textContent = "—"; return; }
    const stats = windStats(state.work?.windReadings || []);
    el.textContent = formatWind(stats.latest);
  }

  function promptWindReading(auto=false, title="Registrar viento previsto"){
    if(!state.work || !isPhytosanitaryWork(state.work)) return;
    if(state.windPromptOpen) return;
    state.windPromptOpen = true;
    try{
      const stats = windStats(state.work.windReadings || []);
      const base = stats.latest !== null ? String(stats.latest).replace(".", ",") : "";
      const raw = prompt(`${title}. Dato de PRONÓSTICO meteorológico, no medición directa en parcela. Viento previsto en km/h:`, base);
      state.work.nextWindPromptAt = Date.now() + 30*60*1000;
      if(raw === null || String(raw).trim() === ""){
        storage.set(LS.active, state.work);
        return;
      }
      const value = Number(String(raw).replace(",", "."));
      if(!isFinite(value) || value < 0 || value > 150){
        toast("Valor de viento previsto no válido. Introduce km/h entre 0 y 150.");
        storage.set(LS.active, state.work);
        return;
      }
      const gustRaw = prompt("Racha prevista en km/h:", "");
      const gustValue = gustRaw === null || String(gustRaw).trim() === "" ? null : Number(String(gustRaw).replace(",", "."));
      if(gustValue !== null && (!isFinite(gustValue) || gustValue < 0 || gustValue > 180)){
        toast("Valor de racha no válido. Se guardará el registro sin racha prevista.");
      }
      const dir = normalizeWindDirection(prompt("Dirección prevista dominante (N, NE, E, SE, S, SO, O, NO):", stats.predominantDirection !== "—" ? stats.predominantDirection : ""));
      const source = String(prompt("Fuente del pronóstico meteorológico:", "Pronóstico meteorológico consultado por el operario") || "Pronóstico meteorológico consultado por el operario").trim();
      const ref = getWindReferencePoint();
      const reading = {
        at: new Date().toISOString(),
        timeLabel: new Date().toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}),
        kmh: value,
        gustKmh: gustValue !== null && isFinite(gustValue) ? gustValue : null,
        direction: dir,
        source,
        reference: ref,
        forecast: true,
        note: "Dato procedente de pronóstico meteorológico, no de medición directa en parcela.",
        autoPrompt: !!auto
      };
      state.work.windReadings = state.work.windReadings || [];
      state.work.windReadings.push(reading);
      updateWindUi();
      storage.set(LS.active, state.work);
    }finally{
      state.windPromptOpen = false;
    }
  }

  function checkWindPrompt(){
    if(!state.work || state.work.status !== "trabajando" || !isPhytosanitaryWork(state.work)) return;
    if(!state.work.nextWindPromptAt) state.work.nextWindPromptAt = Date.now() + 30*60*1000;
    if(Date.now() >= state.work.nextWindPromptAt) promptWindReading(true, "Registro periódico de viento previsto");
  }
  function onGpsError(err){
    $("liveAccuracy").textContent = "Error";
  }

  function classifyPoint(p, prev){
    const acc = p.accuracy ?? Infinity;
    if(acc > 25) return "descartado";
    if(acc > 15) return "dudoso";
    if(prev){
      const dt = Math.max(1, (p.time - prev.time)/1000);
      const vKmh = haversine(prev,p)/dt*3.6;
      if(vKmh > 18) return "descartado";
      if(vKmh > 10) return "dudoso";
    }
    return "valido";
  }

  function onPosition(pos){
    state.currentPos = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      speed: pos.coords.speed,
      time: pos.timestamp,
      device: navigator.userAgent
    };
    const p = state.currentPos;
    $("liveAccuracy").textContent = formatMeters(p.accuracy);
    const spd = (p.speed !== null && isFinite(p.speed)) ? p.speed*3.6 : 0;
    $("liveSpeed").textContent = spd.toFixed(1).replace(".", ",");

    if(!state.work || state.work.status !== "trabajando") {
      drawCurrentPosition(p);
      return;
    }

    const prevClean = state.work.pointsClean.at(-1);
    const cls = classifyPoint(p, prevClean);
    state.work.pointsOriginal.push({...p, quality: cls});
    const st = state.work.gpsStats;
    st.best = Math.min(st.best, p.accuracy);
    st.worst = Math.max(st.worst, p.accuracy);
    st.sum += p.accuracy; st.count += 1;
    if(cls === "dudoso") st.doubtful += 1;
    if(cls === "descartado") st.discarded += 1;

    if(cls !== "descartado"){
      if(prevClean){
        const d = haversine(prevClean, p);
        if(d >= 1.5){
          state.work.distanceM += d;
          state.work.pointsClean.push({...p, quality: cls});
        }
      } else {
        state.work.pointsClean.push({...p, quality: cls});
      }
    }
    updateRouteLayers();
    updateLiveStats();
    storage.set(LS.active, state.work);
  }

  function drawCurrentPosition(p){
    if(!state.maps.work || !p) return;
    if(state.layers.workCurrent) state.layers.workCurrent.remove();
    state.layers.workCurrent = L.circleMarker([p.lat,p.lng], {
      radius: 8, color:"#fff", weight:3, fillColor:"#376a99", fillOpacity:1
    }).addTo(state.maps.work);
  }

  function updateRouteLayers(){
    const map = state.maps.work;
    if(!map || !state.work) return;
    if(state.layers.workRoute) state.layers.workRoute.remove();
    const pts = state.work.pointsClean.map(p => [p.lat,p.lng]);
    if(pts.length > 1){
      state.layers.workRoute = L.polyline(pts, { color:"#1f7ed0", weight:5, opacity:.95 }).addTo(map);
    }
    drawCurrentPosition(state.currentPos);
    if(state.trackingFollow && state.currentPos && state.work?.status === "trabajando"){
      map.setView([state.currentPos.lat, state.currentPos.lng], Math.max(map.getZoom() || 0, 19));
    }
    drawEventMarkers(map);
  }

  function drawEventMarkers(map){
    if(state.layers.workEvents) state.layers.workEvents.remove();
    state.layers.workEvents = L.layerGroup().addTo(map);
    (state.work?.events || []).forEach(ev => {
      if(!ev.lat || !ev.lng) return;
      const color = ev.type === "Comienzo" ? "#2f7d44" : ev.type.includes("Fin") ? "#a8483a" : "#c47b32";
      L.circleMarker([ev.lat, ev.lng], { radius:9, color:"#fff", weight:3, fillColor:color, fillOpacity:1 })
        .bindTooltip(ev.label, { permanent:false })
        .addTo(state.layers.workEvents);
    });
    (state.work?.incidents || []).forEach(inc => {
      if(!inc.lat || !inc.lng) return;
      const color = getIncidentColor(inc.type);
      L.circleMarker([inc.lat, inc.lng], { radius:8, color:"#fff", weight:2, fillColor:color, fillOpacity:1 })
        .bindTooltip(inc.type, { permanent:false })
        .addTo(state.layers.workEvents);
    });
  }

  function addEvent(type, label, notes=""){
    const p = state.currentPos || state.gpsCalibration?.last || null;
    const ev = {
      at: new Date().toISOString(),
      timeLabel: new Date().toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}),
      type, label, notes,
      lat: p?.lat || null, lng: p?.lng || null, accuracy: p?.accuracy || null
    };
    state.work.events.push(ev);
    return ev;
  }

  function openStopModal(){ $("stopModal").classList.remove("hidden"); }
  function closeStopModal(){ $("stopModal").classList.add("hidden"); }

  function handleStop(reason){
    closeStopModal();
    if(!state.work || state.work.status !== "trabajando") return;

    const now = Date.now();
    state.work.stops += 1;

    if(reason === "Fin de tratamiento de la parcela"){
      addEvent("Fin de tratamiento", "Punto final", "Parcela finalizada");
      closeCurrentSession(state.work, now, "Fin de tratamiento de la parcela");
      state.work.status = "finalizado";
      state.work.finishedAt = now;
      state.work.activeMs += now - (state.work.lastSegmentAt || now);
      state.work.pausedAt = null;
      $("stopWorkBtn").classList.add("hidden");
      $("continueWorkBtn").classList.add("hidden");
      $("beginWorkBtn").classList.add("hidden");
      setWorkStateUi("Finalizado");
      stopGpsWatch();
      saveFinishedWork();
      state.reportWork = null;
      state.reportOrigin = "work";
      resetReportTabs();
      renderReport();
      show("screen-report");
      return;
    }

    if(reason === "Recarga cisterna") state.work.refills += 1;
    const n = reason === "Recarga cisterna" ? state.work.refills : state.work.stops;
    addEvent("Parada", `${reason}${reason === "Recarga cisterna" ? " " + n : ""}`, "Punto de continuidad");
    closeCurrentSession(state.work, now, reason);
    state.work.status = "parado";
    state.work.pausedAt = now;
    state.work.activeMs += now - (state.work.lastSegmentAt || now);

    $("stopWorkBtn").classList.add("hidden");
    $("continueWorkBtn").classList.remove("hidden");
    setWorkStateUi("Parado");
    $("refillCount").textContent = String(state.work.refills);
    storage.set(LS.active, state.work);
  }

  function continueWork(){
    if(!state.work || !["parado", "pendiente"].includes(state.work.status)) return;
    const now = Date.now();
    if(state.work.pausedAt) state.work.stoppedMs += now - state.work.pausedAt;
    addEvent("Continuar", "Reanudación", "Continúa el mismo trabajo");
    state.work.status = "trabajando";
    state.work.lastSegmentAt = now;
    state.work.pausedAt = null;
    if(isPhytosanitaryWork(state.work)) state.work.nextWindPromptAt = now + 30*60*1000;
    else { state.work.nextWindPromptAt = null; state.work.windReadings = []; }
    startWorkSession(state.work, now, "Reanudación");
    $("beginWorkBtn").classList.add("hidden");
    $("stopWorkBtn").classList.remove("hidden");
    $("continueWorkBtn").classList.add("hidden");
    setWorkStateUi("Trabajando");
    updateWindUi();
    startGpsWatch();
    storage.set(LS.active, state.work);
  }

  function updateLiveStats(){
    if(!state.work) return;
    $("distanceKm").textContent = (state.work.distanceM/1000).toFixed(2).replace(".", ",");
    $("refillCount").textContent = String(state.work.refills);
    updateWindUi();
  }

  function tick(){
    if(state.work){
      const now = Date.now();
      const totalMs = state.work.startedAt ? (state.work.finishedAt || now) - state.work.startedAt : 0;
      let partialMs = 0;
      if(state.work.status === "trabajando") partialMs = now - (state.work.lastSegmentAt || now);
      else if(state.work.status === "parado") partialMs = now - (state.work.pausedAt || now);
      $("totalTime").textContent = fmtTime(totalMs);
      $("partialTime").textContent = fmtTime(partialMs);
      checkWindPrompt();
    }
    requestAnimationFrame(() => setTimeout(tick, 1000));
  }

  function saveFinishedWork(){
    const hist = storage.get(LS.history, []);
    const finished = serializeWork(state.work);
    const idx = hist.findIndex(w => w.id === finished.id);
    if(idx >= 0) hist[idx] = finished;
    else hist.unshift(finished);
    storage.set(LS.history, hist.slice(0, 200));
    storage.remove(LS.active);
  }
  function serializeWork(w){
    return {
      ...w,
      parcelFeature: w.parcelFeature || state.selectedFeature || null
    };
  }

  function openIncident(context="work"){
    $("incidentNotes").value = "";
    $("newIncidentType").value = "";
    $("incidentPhoto").value = "";
    $("incidentModal").dataset.context = context;
    $("incidentModal").classList.remove("hidden");
  }
  function closeIncident(){ $("incidentModal").classList.add("hidden"); }

  function getIncidentColor(type){
    const defaults = window.PAZO_BAION_DEFAULTS.incidentColors;
    return defaults[type] || "#808080";
  }

  function getCurrentGpsPosition(){
    return new Promise((resolve, reject) => {
      if(!navigator.geolocation) return reject(new Error("GPS no disponible"));
      navigator.geolocation.getCurrentPosition(pos => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          time: pos.timestamp,
          device: navigator.userAgent
        });
      }, err => reject(err), { enableHighAccuracy:true, maximumAge:0, timeout:12000 });
    });
  }

  function freshPosition(p){
    return p && p.time && (Date.now() - p.time) < 120000;
  }

  async function compressPhoto(file){
    if(!file) return null;
    const dataUrl = await new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve,reject)=>{
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const maxSide = 1280;
    let {width, height} = img;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.72);
  }

  async function saveIncident(){
    const btn = $("saveIncident");
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Guardando...";
    try{
      let p = freshPosition(state.currentPos) ? state.currentPos : null;
      if(!p){
        try{
          $("incidentNotes").placeholder = "Obteniendo posición GPS...";
          p = await getCurrentGpsPosition();
          state.currentPos = p;
        }catch(err){
          const ok = confirm("No se pudo obtener una coordenada GPS precisa para esta incidencia. ¿Guardar sin coordenada? Quedará marcado en el informe.");
          if(!ok) return;
        }
      }

      let photo = null;
      const file = $("incidentPhoto").files?.[0];
      if(file) photo = await compressPhoto(file);

      const inc = {
        id: "inc-" + Date.now(),
        at: new Date().toISOString(),
        timeLabel: new Date().toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}),
        parcel: state.selectedParcelName || "Sin parcela",
        type: $("incidentType").value,
        status: $("incidentStatus").value,
        notes: $("incidentNotes").value.trim(),
        lat: p?.lat || null,
        lng: p?.lng || null,
        accuracy: p?.accuracy || null,
        gpsMissing: !p,
        photo
      };

      const all = storage.get(LS.incidents, []);
      all.unshift(inc);
      storage.set(LS.incidents, all);

      if(state.work){
        state.work.incidents.push(inc);
        storage.set(LS.active, state.work);
        updateRouteLayers();
      }
      closeIncident();
      if(state.maps.parcel) drawParcelIncidentMarkers(state.maps.parcel);
      toast("Incidencia guardada localmente.");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function addIncidentType(){
    const v = $("newIncidentType").value.trim();
    if(!v) return;
    const lists = storage.get(LS.lists, {});
    lists.incidentTypes = Array.from(new Set([...(lists.incidentTypes||[]), v]));
    storage.set(LS.lists, lists);
    initLists();
    $("incidentType").value = v;
    $("newIncidentType").value = "";
  }

  function getReportWork(){
    return state.reportWork || state.work || storage.get(LS.history, [])[0] || null;
  }

  function reportTabOrder(w=getReportWork()){
    const tabs = ["summary", "work", "events", "gps"];
    if(isPhytosanitaryWork(w)) tabs.push("wind");
    tabs.push("incidents", "export");
    return tabs;
  }

  function setActiveReportTab(tab){
    qsa("[data-report-tab]").forEach(t => t.classList.remove("active"));
    const target = document.querySelector(`[data-report-tab="${tab}"]`) || document.querySelector('[data-report-tab="summary"]');
    if(target) target.classList.add("active");
  }

  function resetReportTabs(){
    setActiveReportTab("summary");
  }

  function moveReportTab(step){
    const w = getReportWork();
    if(!w) return;
    const order = reportTabOrder(w);
    const current = activeReportTab();
    let idx = order.indexOf(current);
    if(idx < 0) idx = 0;
    idx = Math.max(0, Math.min(order.length - 1, idx + step));
    setActiveReportTab(order[idx]);
    renderReport();
  }

  function openReportForWork(work, origin="work"){
    state.reportWork = work || null;
    state.reportOrigin = origin;
    resetReportTabs();
    show("screen-report");
  }

  function findParcelFeatureByName(name){
    if(!state.parcelsGeoJSON || !name) return null;
    return state.parcelsGeoJSON.features.find(f => featureName(f) === name) || null;
  }

  function reportTotalMs(w){
    return w?.startedAt ? (w.finishedAt || Date.now()) - w.startedAt : 0;
  }

  function reportEffectiveActiveMs(w){
    let ms = w?.activeMs || 0;
    if(w?.status === "trabajando" && w.lastSegmentAt) ms += Date.now() - w.lastSegmentAt;
    return ms;
  }

  function reportAverageSpeed(w){
    const activeHours = reportEffectiveActiveMs(w) / 3600000;
    if(!activeHours || !isFinite(activeHours)) return null;
    return (w.distanceM || 0) / 1000 / activeHours;
  }

  function reportEmpty(text){
    return `<div class="report-empty">${escapeHtml(text)}</div>`;
  }

  function reportKpi(label, value, note=""){
    return `<div class="report-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>`;
  }

  function activeReportTab(){
    return document.querySelector(".report-tabs .tab.active")?.dataset.reportTab || "summary";
  }

  function renderReport(){
    const w = getReportWork();
    if(!w){
      $("reportContent").innerHTML = reportEmpty("No hay trabajo para informar.");
      const oldMap = $("reportMap");
      if(oldMap) oldMap.classList.add("hidden");
      return;
    }

    $("reportSubtitle").textContent = `${w.parcel || "—"} · ${w.type || "—"}`;
    $("reportStatusChip").textContent = w.status === "finalizado" ? "Informe definitivo" : "Resumen provisional";
    $("reportStatusChip").style.background = w.status === "finalizado" ? "#eaf6e9" : "#fff4e6";
    $("reportStatusChip").style.color = w.status === "finalizado" ? "#2f7d44" : "#8b520e";
    $("reportTotal").textContent = fmtDurationCompact(reportTotalMs(w));
    $("reportDistance").textContent = distanceKmCompactText(w);
    $("reportRefills").textContent = String(w.refills || 0);
    $("reportIncidentsTop").textContent = String((w.incidents || []).length);
    const windTab = $("reportWindTab");
    if(windTab) windTab.classList.toggle("hidden", !isPhytosanitaryWork(w));
    if(!isPhytosanitaryWork(w) && activeReportTab() === "wind") resetReportTabs();

    const tab = activeReportTab();
    if(tab === "summary") renderReportSummary(w);
    if(tab === "work") renderReportWork(w);
    if(tab === "events") renderReportEvents(w);
    if(tab === "gps") renderReportGps(w);
    if(tab === "wind") renderReportWind(w);
    if(tab === "incidents") renderReportIncidents(w);
    if(tab === "export") renderReportExport(w);
    renderReportMap(w, activeReportTab());
  }

  function distanceKmText(w){
    return `${((w.distanceM || 0)/1000).toFixed(2).replace(".", ",")} km`;
  }

  function distanceKmCompactText(w){
    const km = ((w?.distanceM || 0) / 1000);
    const digits = km < 0.1 ? 2 : 1;
    return `${km.toFixed(digits).replace(".", ",")} km`;
  }

  function reportDateText(w){
    const raw = w?.finishedAt || w?.startedAt || Date.now();
    return new Date(raw).toLocaleDateString("es-ES");
  }

  function reportTimeText(raw){
    if(!raw) return "—";
    return new Date(raw).toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"});
  }

  function reportIcon(name){
    const path = {
      summary:'<path d="M4 7h16"/><path d="M4 12h13"/><path d="M4 17h10"/><circle cx="6" cy="7" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none"/>',
      work:'<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8"/>',
      events:'<rect x="5" y="5" width="14" height="15" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M8 11h8"/><path d="M8 15h5"/>',
      gps:'<path d="M12 18a6 6 0 0 0 0-12"/><path d="M12 22a10 10 0 0 0 0-20"/><circle cx="8" cy="12" r="2"/>',
      wind:'<path d="M4 8h10a3 3 0 1 0-3-3"/><path d="M4 13h14a3 3 0 1 1-3 3"/><path d="M4 18h7"/>',
      incidents:'<path d="M12 5l8 14H4z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
      map:'<path d="M12 21s7-5.5 7-12a7 7 0 1 0-14 0c0 6.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.2"/>',
      clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
      parcel:'<path d="M4 17c2.5-2 5.5-2 8 0"/><path d="M12 17c2.5-2 5.5-2 8 0"/><path d="M7 17v-4"/><path d="M17 17v-4"/><path d="M4 13c1.2-1.2 2.6-1.8 4-1.8s2.8.6 4 1.8"/><path d="M12 13c1.2-1.2 2.6-1.8 4-1.8s2.8.6 4 1.8"/><path d="M7 11V7"/><path d="M17 11V7"/>',
      labor:'<path d="M7 20v-5"/><path d="M11 20v-8"/><path d="M15 20v-6"/><path d="M4 9c2-1 4-3 5-5 1 2 3 4 5 5"/><path d="M16 5l4 4"/><path d="M18 3v4h-4"/>',
      leaf:'<path d="M18.5 5.5c-6.5-.7-10.6 2.3-11.9 8.4-.5 2.4.4 4.8 2.2 6.1 1.8 1.3 4.2 1.5 6.2.4 5.3-2.8 5.2-8.8 3.5-14.9z"/><path d="M8 15c2.5-1.3 4.8-3.5 6.5-6.5"/><path d="M7 20l3-3"/>',
      conclusion:'<path d="M7 12l3 3 7-7"/><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6"/>'
    }[name] || '<circle cx="12" cy="12" r="8"/>';
    return `<svg class="report-icon-svg" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  }

  function reportScreen(title, icon, body, opts={}){
    const note = opts.note ? `<div class="fixed-report-note">${reportIcon("clock")}<span>${escapeHtml(opts.note)}</span></div>` : "";
    return `<div class="scroll-box fixed-report-screen">
      <section class="fixed-report-card fixed-report-main">
        <h2 class="fixed-report-title">${reportIcon(icon)}<span>${escapeHtml(title)}</span></h2>
        ${body}
      </section>
      ${note}
    </div>`;
  }

  function fixedKpi(label, value, icon="", tone=""){
    return `<div class="fixed-kpi ${tone}"><span>${escapeHtml(label)}</span>${icon ? `<em>${reportIcon(icon)}</em>` : ""}<strong>${escapeHtml(value)}</strong></div>`;
  }

  function fixedMini(label, value, icon=""){
    return `<div class="fixed-mini-card${icon ? " has-icon" : ""}">${icon ? `<div class="fixed-mini-head">${reportIcon(icon)}<span>${escapeHtml(label)}</span></div>` : `<span>${escapeHtml(label)}</span>`}<strong>${escapeHtml(value)}</strong></div>`;
  }

  function fixedMeta(items){
    return `<div class="fixed-meta-strip">${items.map(it => `<span>${it.icon ? reportIcon(it.icon) : ""}${escapeHtml(it.label)}${it.value ? ` <strong>${escapeHtml(it.value)}</strong>` : ""}</span>`).join('<b>·</b>')}</div>`;
  }

  function fixedMapBlock(title, mode="summary"){
    return `<div class="fixed-map-block" data-map-mode="${escapeHtml(mode)}"><div class="fixed-map-title">${reportIcon("map")}<span>${escapeHtml(title)}</span></div><div id="reportVisualMap" class="report-map fixed-report-map"></div></div>`;
  }

  function reportConclusion(text, icon="conclusion", rightIcon="leaf"){
    return `<div class="fixed-conclusion">${reportIcon(icon)}<div><strong>Conclusión</strong><span>${escapeHtml(text)}</span></div><i>${reportIcon(rightIcon)}</i></div>`;
  }

  function eventCounts(w){
    const events = w.events || [];
    const paradas = events.filter(e => e.type === "Parada" && !/recarga/i.test(`${e.label || ""} ${e.notes || ""}`)).length;
    return {events:events.length, paradas, recargas:w.refills || 0, incidencias:(w.incidents || []).length};
  }

  function incidentBreakdown(incidents){
    const map = new Map();
    (incidents || []).forEach(i => map.set(i.type || "Otra", (map.get(i.type || "Otra") || 0) + 1));
    return Array.from(map.entries()).slice(0,4);
  }

  function routeColorByQuality(p){
    const acc = Number(p?.accuracy);
    if(isFinite(acc)){
      if(acc <= 5) return "#2f7d44";
      if(acc <= 10) return "#d6a43b";
      if(acc <= 15) return "#c47b32";
      return "#a8483a";
    }
    if(p?.quality === "valido") return "#2f7d44";
    if(p?.quality === "dudoso") return "#c47b32";
    return "#a8483a";
  }

  function drawRouteOnMap(map, pts, mode="summary"){
    if(!pts || pts.length < 2) return null;
    if(mode === "gps"){
      let bounds = null;
      for(let i=1;i<pts.length;i++){
        const a = pts[i-1], b = pts[i];
        const seg = L.polyline([[a.lat,a.lng],[b.lat,b.lng]], {color:routeColorByQuality(b), weight:5, opacity:.95}).addTo(map);
        bounds = bounds && bounds.isValid() ? bounds.extend(seg.getBounds()) : seg.getBounds();
      }
      return bounds;
    }
    const routeColor = mode === "wind" ? "#d6a43b" : "#96c34b";
    const route = L.polyline(pts.map(p=>[p.lat,p.lng]), {color: routeColor, weight:5, opacity:.96}).addTo(map);
    return route.getBounds();
  }

  function makeWindIcon(reading){
    const level = windLevel(reading.kmh);
    const deg = directionToDegrees(reading.direction);
    return L.divIcon({
      className:"wind-arrow-marker",
      html:`<div class="wind-arrow" style="--wind-color:${level.color};--wind-rot:${deg}deg">➜</div>`,
      iconSize:[28,28],
      iconAnchor:[14,14]
    });
  }

  function addReportMapNotice(text, target=null){
    const el = target || $("reportVisualMap") || $("reportMap");
    if(!el) return;
    const notice = document.createElement("div");
    notice.className = "report-map-notice";
    notice.textContent = text;
    el.appendChild(notice);
  }

  function renderReportMap(w, mode="summary"){
    const legacy = $("reportMap");
    if(legacy) legacy.classList.add("hidden");
    const el = $("reportVisualMap");
    if(!el){
      if(state.maps.report){ try{ state.maps.report.off(); state.maps.report.remove(); }catch{} state.maps.report = null; }
      return;
    }
    waitForMapContainer("reportVisualMap", () => {
      if(state.maps.report){
        try{ state.maps.report.off(); state.maps.report.remove(); }catch{}
        state.maps.report = null;
      }
      el.innerHTML = "";
      if(!ensureLeaflet()){
        addReportMapNotice("No se pudo cargar el mapa satelital.", el);
        return;
      }
      const map = L.map(el, { zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, tap:false, preferCanvas:true, fadeAnimation:false, zoomAnimation:false, markerZoomAnimation:false });
      state.maps.report = map;
      const tile = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom:20, keepBuffer:4 }).addTo(map);
      map._pbgpsTile = tile;
      const reportFeature = w.parcelFeature || findParcelFeatureByName(w.parcel) || (w.parcel === state.selectedParcelName ? state.selectedFeature : null);
      let bounds = null;
      if(reportFeature) {
        const lyr = L.geoJSON(reportFeature, { style: parcelStyle(true) }).addTo(map).bringToFront();
        bounds = lyr.getBounds();
      }
      drawImportedIncidents(map, "reportImportedIncidents");
      const pts = (w.pointsClean || []).filter(p=>isFinite(p.lat) && isFinite(p.lng));
      const needsRoute = ["summary", "gps", "wind"].includes(mode);
      if(needsRoute){
        const routeBounds = drawRouteOnMap(map, pts, mode);
        if(routeBounds) bounds = bounds && bounds.isValid() ? bounds.extend(routeBounds) : routeBounds;
      }
      if(["summary", "events"].includes(mode)){
        (w.events || []).forEach(ev => {
          if(ev.lat && ev.lng) L.circleMarker([ev.lat,ev.lng], {radius:6,color:"#fff",weight:2,fillColor:ev.type.includes("Fin")?"#a8483a":ev.type==="Comienzo"?"#2f7d44":"#c47b32",fillOpacity:1}).bindTooltip(ev.label || ev.type, {permanent:false}).addTo(map);
        });
      }
      if(["summary", "incidents"].includes(mode)){
        (w.incidents || []).forEach(inc => {
          if(inc.lat && inc.lng) L.circleMarker([inc.lat,inc.lng], {radius:8,color:"#fff",weight:2,fillColor:getIncidentColor(inc.type),fillOpacity:1}).bindTooltip(inc.type || "Incidencia", {permanent:mode === "incidents", direction:"right", className:"imported-incident-label"}).addTo(map);
        });
      }
      if(mode === "wind" && isPhytosanitaryWork(w)){
        (w.windReadings || []).forEach((r, idx) => {
          const ref = r.reference || {};
          let lat = Number(ref.lat), lng = Number(ref.lng);
          if((!isFinite(lat) || !isFinite(lng)) && pts.length){
            const p = pts[Math.min(pts.length-1, Math.round((idx/(Math.max(1,(w.windReadings||[]).length-1))) * (pts.length-1)))];
            lat = p.lat; lng = p.lng;
          }
          if(isFinite(lat) && isFinite(lng)){
            L.marker([lat,lng], {icon: makeWindIcon(r)}).bindTooltip(`${formatWind(r.kmh)} · ${normalizeWindDirection(r.direction)}`, {permanent:false}).addTo(map);
          }
        });
      }
      if(bounds && bounds.isValid()) stabilizeMap(map, bounds, [18,18]);
      else stabilizeMap(map, null, [18,18]);
      if(needsRoute && !pts.length) addReportMapNotice("No hay recorrido GPS registrado para este trabajo", el);
    });
  }

  function reportWarning(w){
    const gps = w.gpsStats || {};
    if(w.forcedStart || gps.discarded > 0 || (gps.worst && gps.worst > 15)){
      return `<div class="report-warning slim"><strong>Advertencia GPS:</strong> el trazado debe interpretarse como aproximado en algunos tramos. Se conservaron los puntos originales y se generó una ruta depurada para visualización e informe.</div>`;
    }
    return "";
  }

  function renderReportSummary(w){
    const day = w.day || {};
    const status = w.status === "finalizado" ? "Finalizado" : "Provisional";
    const body = `
      <div class="summary-template">
        <div class="fixed-kpi-row summary-kpis">
          ${fixedKpi("Tiempo total", fmtDurationCompact(reportTotalMs(w)), "clock")}
          ${fixedKpi("Distancia", distanceKmCompactText(w), "map")}
          ${fixedKpi("Recargas", String(w.refills || 0), "work")}
          ${fixedKpi("Incidencias", String((w.incidents || []).length), "incidents")}
        </div>
        ${fixedMeta([
          {icon:"conclusion", label:status},
          {icon:"events", label:reportDateText(w)},
          {icon:"work", label:"Operario:", value:day.operator || "—"},
          {icon:"work", label:"Tractor:", value:day.tractor || "—"}
        ])}
        ${fixedMapBlock("Mapa de la parcela y recorrido", "summary")}
        <h3 class="fixed-subtitle">${reportIcon("clock")}<span>Datos del trabajo</span></h3>
        <div class="fixed-mini-grid fixed-mini-grid-3 summary-data-grid">
          ${fixedMini("Parcela", w.parcel || "—", "parcel")}
          ${fixedMini("Labor", w.type || "—", "labor")}
          ${fixedMini("Estado", status, "conclusion")}
          ${fixedMini("Inicio", reportTimeText(w.startedAt), "clock")}
          ${fixedMini("Fin", reportTimeText(w.finishedAt), "clock")}
          ${fixedMini("Tiempo activo", fmtDurationCompact(reportEffectiveActiveMs(w)), "clock")}
        </div>
        ${reportConclusion(w.status === "finalizado" ? `El trabajo se completó correctamente. Se realizaron ${w.refills || 0} recargas y se registraron ${(w.incidents || []).length} incidencias durante la aplicación.` : "El trabajo continúa pendiente. El informe se completará al finalizar la parcela.")}
      </div>
    `;
    $("reportContent").innerHTML = reportScreen("Resumen general", "summary", body);
  }

  function renderReportWork(w){
    const rows = sessionRows(w);
    const active = rows.reduce((a,s)=>a+(s.activeMs||0), 0) || reportEffectiveActiveMs(w);
    const stopped = rows.reduce((a,s)=>a+(s.stoppedMs||0), 0) || (w.stoppedMs || 0);
    const sessionsHtml = rows.map((s) => `
      <div class="fixed-session-row tone-${((s.index-1)%3)+1}">
        <span class="fixed-session-index">${s.index}</span>
        <strong>${s.start ? new Date(s.start).toLocaleDateString("es-ES") : "—"}</strong>
        <span>${reportTimeText(s.start)}<small>Inicio</small></span>
        <b>→</b>
        <span>${reportTimeText(s.end)}<small>Fin</small></span>
        <em>${fmtDurationCompact(s.activeMs || 0)}<small>Activo</small></em>
      </div>`).join("");
    const tableRows = rows.map(s => `<tr><td><span class="quality-dot tone-${((s.index-1)%3)+1}">●</span> ${s.start ? new Date(s.start).toLocaleDateString("es-ES") : "—"}</td><td>${reportTimeText(s.start)}</td><td>${reportTimeText(s.end)}</td><td>${fmtDurationCompact(s.activeMs || 0)}</td><td>${fmtDurationCompact(s.stoppedMs || 0)}</td></tr>`).join("");
    const body = `
      <div class="fixed-kpi-row">
        ${fixedKpi("Tiempo activo", fmtDurationCompact(active), "clock")}
        ${fixedKpi("Tiempo parado", fmtDurationCompact(stopped), "clock", "amber")}
        ${fixedKpi("Sesiones", String(rows.length), "work")}
        ${fixedKpi("Recargas", String(w.refills || 0), "events", "amber")}
      </div>
      <div class="fixed-legend-row">${rows.map(s=>`<span><b class="quality-dot tone-${((s.index-1)%3)+1}">●</b> Sesión ${s.index} ${fmtDurationCompact(s.activeMs || 0)}</span>`).join('<b>·</b>')}</div>
      <h3 class="fixed-subtitle">${reportIcon("clock")}<span>Sesiones de trabajo</span></h3>
      <div class="fixed-session-list">${sessionsHtml || reportEmpty("Sin sesiones registradas todavía.")}</div>
      <h3 class="fixed-subtitle">${reportIcon("clock")}<span>Detalle por sesiones</span></h3>
      <table class="report-table fixed-table"><thead><tr><th>Fecha</th><th>Inicio</th><th>Fin</th><th>Activo</th><th>Parado</th></tr></thead><tbody>${tableRows || `<tr><td colspan="5">Sin datos.</td></tr>`}</tbody></table>
      ${reportConclusion(rows.length > 1 ? `La parcela se completó en ${rows.length} jornadas de trabajo. El tiempo total de aplicación efectiva fue de ${fmtDurationCompact(active)}.` : `Tiempo activo acumulado: ${fmtDurationCompact(active)}.`)}
    `;
    $("reportContent").innerHTML = reportScreen("Resumen de trabajo", "wind", body, isPhytosanitaryWork(w) ? {note:"Dato procedente de pronóstico meteorológico, no de medición directa en parcela."} : {});
  }

  function renderReportEvents(w){
    const events = w.events || [];
    const counts = eventCounts(w);
    const rows = events.map(ev => {
      const kind = ev.type.includes("Fin") ? "bad" : ev.type === "Comienzo" || ev.type === "Continuar" ? "good" : /incid/i.test(ev.type) ? "bad" : "warn";
      const label = ev.notes || ev.label || "—";
      return `<div class="fixed-timeline-row"><time>${escapeHtml(ev.timeLabel || "—")}</time><span class="timeline-line-dot ${kind}"></span><i>${reportIcon(/incid/i.test(ev.type) ? "incidents" : ev.type === "Parada" ? "clock" : "work")}</i><div><strong>${escapeHtml(ev.type || "—")}</strong><small>${escapeHtml(label)}</small></div></div>`;
    }).join("");
    const tableRows = events.map(ev => `<tr><td>${escapeHtml(ev.timeLabel || "—")}</td><td>${escapeHtml(ev.type || "—")}</td><td>${escapeHtml(ev.notes || ev.label || "—")}</td></tr>`).join("");
    const body = `
      <div class="fixed-kpi-row">
        ${fixedKpi("Eventos", String(counts.events))}
        ${fixedKpi("Paradas", String(counts.paradas), "clock", "amber")}
        ${fixedKpi("Recargas", String(counts.recargas), "work")}
        ${fixedKpi("Incidencias", String(counts.incidencias), "incidents", "danger")}
      </div>
      ${fixedMeta([{icon:"clock", label:"Inicio", value:reportTimeText(w.startedAt)}, {icon:"clock", label:"Último evento", value:events.at(-1)?.timeLabel || reportTimeText(w.finishedAt)}, {icon:"conclusion", label:"Estado", value:w.status === "finalizado" ? "Finalizado" : "Pendiente"}])}
      <h3 class="fixed-subtitle">${reportIcon("clock")}<span>Cronología del trabajo</span></h3>
      <div class="fixed-timeline-list">${rows || reportEmpty("Sin eventos registrados todavía.")}</div>
      <h3 class="fixed-subtitle">${reportIcon("summary")}<span>Detalle de eventos</span></h3>
      <table class="report-table fixed-table"><thead><tr><th>Hora</th><th>Evento</th><th>Observación</th></tr></thead><tbody>${tableRows || `<tr><td colspan="3">Sin datos.</td></tr>`}</tbody></table>
      ${reportConclusion(events.length ? `La actividad se completó con ${counts.paradas} paradas y ${counts.recargas} recargas. Todos los eventos relevantes fueron registrados correctamente.` : "Sin eventos registrados todavía.")}
    `;
    $("reportContent").innerHTML = reportScreen("Resumen de eventos", "events", body);
  }

  function renderReportIncidents(w){
    const incidents = w.incidents || [];
    const pending = incidents.filter(i => String(i.status || "").toLowerCase().includes("pendiente")).length;
    const resolved = incidents.filter(i => /reparada|resuelta|revisada|descartada/i.test(i.status || "")).length;
    const photos = incidents.filter(i => i.photo).length;
    const breakdown = incidentBreakdown(incidents);
    const tableRows = incidents.map(i => `<tr><td>${escapeHtml(i.timeLabel || "—")}</td><td><span class="quality-dot" style="background:${getIncidentColor(i.type)}"></span> ${escapeHtml(i.type || "—")}</td><td><span class="fixed-pill ${String(i.status||"").toLowerCase().includes("pendiente") ? "pending" : "resolved"}">${escapeHtml(i.status || "—")}</span></td><td>${i.photo ? "📷" : "—"}</td></tr>`).join("");
    const body = `
      <div class="fixed-kpi-row">
        ${fixedKpi("Total", String(incidents.length))}
        ${fixedKpi("Pendientes", String(pending), "incidents", "amber")}
        ${fixedKpi("Resueltas", String(resolved), "conclusion")}
        ${fixedKpi("Fotos", String(photos), "map", "amber")}
      </div>
      <div class="fixed-legend-row">${breakdown.map(([type,count])=>`<span><b class="quality-dot" style="background:${getIncidentColor(type)}"></b> ${escapeHtml(type)} ${count}</span>`).join('<b>·</b>') || '<span>Sin incidencias</span>'}</div>
      ${fixedMapBlock("Mapa de incidencias", "incidents")}
      <h3 class="fixed-subtitle">${reportIcon("summary")}<span>Detalle de incidencias</span></h3>
      <table class="report-table fixed-table"><thead><tr><th>Hora</th><th>Tipo de incidencia</th><th>Estado</th><th>Foto</th></tr></thead><tbody>${tableRows || `<tr><td colspan="4">Sin incidencias registradas.</td></tr>`}</tbody></table>
      ${reportConclusion(incidents.length ? `Se registraron ${incidents.length} incidencias durante el trabajo. Se resolvieron ${resolved} y ${pending} queda pendiente de revisión.` : "No se registraron incidencias durante este trabajo.")}
    `;
    $("reportContent").innerHTML = reportScreen("Resumen de incidencias", "incidents", body, isPhytosanitaryWork(w) ? {note:"Dato procedente de pronóstico meteorológico, no de medición directa en parcela."} : {});
  }

  function renderReportGps(w){
    const gps = w.gpsStats || {};
    const avgAcc = gps.count ? (gps.sum / gps.count) : null;
    const points = (w.pointsClean || []).length;
    const intervals = gpsIntervals(w);
    const tableRows = intervals.map(r => `<tr><td>${escapeHtml(r.interval)}</td><td>${formatMetersDetailed(r.avg)}</td><td><span class="quality-dot ${gpsClass(r.avg).cls}">●</span> ${gpsClass(r.avg).label}</td></tr>`).join("");
    const body = `
      ${reportWarning(w)}
      <div class="fixed-kpi-row">
        ${fixedKpi("Precisión media", formatMetersDetailed(avgAcc), "gps")}
        ${fixedKpi("Mejor", formatMetersDetailed(gps.best), "gps")}
        ${fixedKpi("Peor", formatMetersDetailed(gps.worst), "gps")}
        ${fixedKpi("Puntos válidos", String(points), "gps")}
      </div>
      <div class="fixed-legend-row"><span><b class="quality-dot good"></b> Buena 0–5 m</span><span><b class="quality-dot accept"></b> Aceptable 5–10 m</span><span><b class="quality-dot warn"></b> Insuficiente 10–15 m</span><span><b class="quality-dot bad"></b> Mala &gt;15 m</span></div>
      ${fixedMapBlock("Mapa de la parcela y trazado GPS", "gps")}
      <h3 class="fixed-subtitle">${reportIcon("clock")}<span>Detalle por intervalos</span></h3>
      <table class="report-table fixed-table"><thead><tr><th>Intervalo</th><th>Precisión</th><th>Estado</th></tr></thead><tbody>${tableRows || `<tr><td colspan="3">Sin datos GPS por intervalos.</td></tr>`}</tbody></table>
      ${reportConclusion(points ? "La mayor parte del trazado se registró con buena calidad GPS, con algunos intervalos puntuales de menor precisión." : "No hay recorrido GPS registrado para este trabajo.", "gps")}
    `;
    $("reportContent").innerHTML = reportScreen("Resumen GPS", "gps", body);
  }

  function gpsIntervals(w){
    const pts = (w.pointsClean || []).filter(p => p.time && isFinite(p.accuracy));
    if(!pts.length) return [];
    const buckets = {};
    pts.forEach(p => {
      const d = new Date(p.time);
      const startMin = Math.floor(d.getMinutes()/30)*30;
      const start = new Date(d); start.setMinutes(startMin,0,0);
      const end = new Date(start.getTime()+30*60000);
      const key = `${start.toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"})}–${end.toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"})}`;
      buckets[key] = buckets[key] || [];
      buckets[key].push(Number(p.accuracy));
    });
    return Object.entries(buckets).map(([interval, vals]) => ({interval, avg: vals.reduce((a,b)=>a+b,0)/vals.length}));
  }

  function renderReportWind(w){
    if(!isPhytosanitaryWork(w)){
      $("reportContent").innerHTML = reportScreen("Resumen de viento", "wind", reportEmpty("El viento solo se muestra y registra en trabajos de Aplicación de fitosanitarios."));
      return;
    }
    const readings = w.windReadings || [];
    const ws = windStats(readings);
    const tableRows = readings.map(r => { const level = windLevel(r.kmh); return `<tr><td>${escapeHtml(r.timeLabel || "—")}</td><td>${formatWind(r.kmh)}</td><td>${formatWind(r.gustKmh)}</td><td>${escapeHtml(normalizeWindDirection(r.direction))}</td><td><span class="quality-dot ${level.cls}">●</span> ${level.label}</td></tr>`; }).join("");
    const body = `
      <div class="fixed-kpi-row">
        ${fixedKpi("Viento medio", ws.avg === null ? "—" : formatWind(ws.avg), "wind")}
        ${fixedKpi("Viento máximo", ws.max === null ? "—" : formatWind(ws.max), "wind")}
        ${fixedKpi("Dirección predominante", ws.predominantDirection || "—", "wind")}
        ${fixedKpi("Estado global", ws.global.label, "wind", ws.global.cls === "bad" ? "danger" : ws.global.cls === "warn" ? "amber" : "")}
      </div>
      <div class="fixed-legend-row"><span><b class="quality-dot good"></b> Verde 0–10,8 km/h</span><span><b class="quality-dot warn"></b> Ámbar 10,9–15,3 km/h</span><span><b class="quality-dot bad"></b> Rojo &gt;15,3 km/h</span></div>
      ${fixedMapBlock("Mapa de la parcela y recorrido", "wind")}
      <h3 class="fixed-subtitle">${reportIcon("clock")}<span>Detalle por intervalos</span></h3>
      <table class="report-table fixed-table"><thead><tr><th>Intervalo</th><th>Viento</th><th>Dirección</th><th>Estado</th></tr></thead><tbody>${readings.map(r=>{ const level=windLevel(r.kmh); return `<tr><td>${escapeHtml(r.timeLabel || "—")}</td><td>${formatWind(r.kmh)}</td><td>${escapeHtml(normalizeWindDirection(r.direction))}</td><td><span class="quality-dot ${level.cls}">●</span> ${level.label}</td></tr>`; }).join("") || `<tr><td colspan="4">Sin registros de viento previsto.</td></tr>`}</tbody></table>
      ${reportConclusion(readings.length ? `${ws.global.detail} Se registraron intervalos de viento previsto durante el trabajo.` : "Sin registros de viento previsto durante el trabajo.", "wind")}
    `;
    $("reportContent").innerHTML = reportScreen("Resumen de viento", "wind", body, {note:"Dato procedente de pronóstico meteorológico, no de medición directa en parcela."});
  }

  function renderReportExport(w){
    $("reportContent").innerHTML = `
      <div class="scroll-box export-grid report-visual">
        <button class="btn primary full" id="shareReport">Compartir resumen</button>
        <button class="btn ghost full" id="downloadJson">Exportar JSON completo</button>
        <button class="btn ghost full" id="downloadCsv">Exportar CSV eventos</button>
        ${isPhytosanitaryWork(w) ? `<button class="btn ghost full" id="downloadWindCsv">Exportar CSV viento</button>` : ""}
        <button class="btn ghost full" id="downloadGeojson">Exportar ruta GeoJSON</button>
        <button class="btn ghost full" id="downloadGpx">Exportar ruta GPX</button>
        <button class="btn ghost full" id="downloadKml">Exportar ruta KML</button>
        <button class="btn ghost full" id="printReport">Imprimir / Guardar PDF</button>
        <p>Los archivos se generan localmente desde este dispositivo.</p>
      </div>`;
    $("shareReport").onclick = () => shareReportSummary(w);
    $("downloadJson").onclick = () => downloadBlob(safeFilename(w, "trabajo", "json"), JSON.stringify(w, null, 2), "application/json");
    $("downloadCsv").onclick = () => exportEventsCsv(w);
    if($("downloadWindCsv")) $("downloadWindCsv").onclick = () => exportWindCsv(w);
    $("downloadGeojson").onclick = () => exportRouteGeoJSON(w);
    $("downloadGpx").onclick = () => exportRouteGPX(w);
    $("downloadKml").onclick = () => exportRouteKML(w);
    $("printReport").onclick = () => window.print();
  }

  function safeFilename(w, base, ext){
    const name = `${base}_${w.parcel || "parcela"}_${w.startedAt ? new Date(w.startedAt).toISOString().slice(0,10) : todayIso()}`
      .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return `${name}.${ext}`;
  }

  function downloadBlob(filename, text, type){
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], {type}));
    a.download = filename;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
  }
  function exportEventsCsv(w){
    const header = "hora,tipo,punto,gps,observacion\n";
    const rows = (w.events || []).map(e => [e.timeLabel,e.type,e.label,formatMeters(e.accuracy),e.notes].map(v => `"${String(v||"").replaceAll('"','""')}"`).join(",")).join("\n");
    downloadBlob(safeFilename(w, "eventos", "csv"), header + rows, "text/csv");
  }

  function exportWindCsv(w){
    const header = "hora,viento_kmh,racha_kmh,direccion,fuente,referencia,tipo_registro,nota\n";
    const rows = (w.windReadings || []).map(r => [r.timeLabel, r.kmh, r.gustKmh, r.direction, r.source, formatReferencePoint(r.reference), r.autoPrompt ? "periodico" : "manual", "pronostico meteorologico; no medicion directa en parcela"].map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
    downloadBlob(safeFilename(w, "viento", "csv"), header + rows, "text/csv");
  }

  function exportRouteGeoJSON(w){
    const gj = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { parcela: w.parcel, trabajo: w.type, inicio: w.startedAt, fin: w.finishedAt, version: VERSION },
        geometry: { type: "LineString", coordinates: (w.pointsClean || []).map(p => [p.lng, p.lat]) }
      }]
    };
    downloadBlob(safeFilename(w, "ruta", "geojson"), JSON.stringify(gj, null, 2), "application/geo+json");
  }

  function exportRouteGPX(w){
    const pts = (w.pointsClean || []).map(p => `<trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.time).toISOString()}</time></trkpt>`).join("");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Pazo Baion GPS"><trk><name>${escapeXml(w.parcel)} - ${escapeXml(w.type)}</name><trkseg>${pts}</trkseg></trk></gpx>`;
    downloadBlob(safeFilename(w, "ruta", "gpx"), gpx, "application/gpx+xml");
  }

  function exportRouteKML(w){
    const coords = (w.pointsClean || []).map(p => `${p.lng},${p.lat},0`).join(" ");
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${escapeXml(w.parcel)} - ${escapeXml(w.type)}</name><LineString><coordinates>${coords}</coordinates></LineString></Placemark></Document></kml>`;
    downloadBlob(safeFilename(w, "ruta", "kml"), kml, "application/vnd.google-earth.kml+xml");
  }

  function escapeXml(s){
    return String(s ?? "").replace(/[<>&"']/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;","\"":"&quot;","'":"&apos;"}[c]));
  }

  async function shareReportSummary(w){
    const text = `PAZO BAION GPS\nParcela: ${w.parcel}\nTrabajo: ${w.type}\nEstado: ${w.status}\nDistancia: ${((w.distanceM || 0)/1000).toFixed(2)} km\nRecargas: ${w.refills || 0}\nIncidencias: ${(w.incidents || []).length}`;
    if(navigator.share){
      try{ await navigator.share({ title:"Informe Pazo Baion GPS", text }); return; } catch(err){}
    }
    try{ await navigator.clipboard.writeText(text); toast("Resumen copiado al portapapeles."); }
    catch{ toast(text); }
  }

  function workIsCompleted(w){
    return Boolean(w?.finishedAt || w?.status === "finalizado" || w?.status === "completado");
  }

  function workHistoryStatus(w){
    return workIsCompleted(w) ? "Completado" : "Pendiente";
  }

  function workHistoryDate(w){
    const raw = w?.finishedAt || w?.startedAt || w?.createdAt || w?.id?.replace("trabajo-", "") || null;
    const n = Number(raw);
    const d = raw ? new Date(isFinite(n) && String(raw).length >= 10 ? n : raw) : null;
    return d && !isNaN(d.getTime()) ? d.toLocaleDateString("es-ES") : "Sin fecha";
  }

  function upsertPendingWorkInHistory(){
    if(!state.work || workIsCompleted(state.work)) return;
    const hist = storage.get(LS.history, []);
    const now = Date.now();
    const snap = serializeWork({...state.work, status:"pendiente"});
    if(state.work.status === "trabajando" && state.work.lastSegmentAt){
      closeCurrentSession(snap, now, "Trabajo pendiente");
      snap.activeMs = (snap.activeMs || 0) + Math.max(0, now - (state.work.lastSegmentAt || now));
      snap.pausedAt = now;
      snap.lastSegmentAt = null;
    }
    const idx = hist.findIndex(w => w.id === snap.id);
    if(idx >= 0) hist[idx] = snap;
    else hist.unshift(snap);
    storage.set(LS.history, hist.slice(0, 200));
  }

  function resumePendingWorkFromHistory(index){
    const hist = storage.get(LS.history, []);
    const w = hist[index];
    if(!w || workIsCompleted(w)) return;
    state.selectedParcelName = w.parcel || "";
    state.selectedFeature = w.parcelFeature || findParcelFeatureByName(w.parcel);
    state.workType = w.type || "";
    state.gpsCalibration = w.gpsCalibration || null;
    state.work = serializeWork({...w});
    state.work.status = state.work.startedAt ? "parado" : "preparado";
    if(state.work.startedAt && !state.work.pausedAt) state.work.pausedAt = Date.now();
    state.work.currentSessionId = null;
    if(!isPhytosanitaryWork(state.work)){ state.work.windReadings = []; state.work.nextWindPromptAt = null; }
    state.reportWork = null;
    state.reportOrigin = "work";
    storage.set(LS.active, state.work);
    const header = $("workHeader");
    if(header) header.textContent = `${state.selectedParcelName} · ${state.workType}`;
    resetLiveUi();
    $("beginWorkBtn").classList.toggle("hidden", Boolean(state.work.startedAt));
    $("continueWorkBtn").classList.toggle("hidden", !state.work.startedAt);
    $("stopWorkBtn").classList.add("hidden");
    setWorkStateUi(state.work.startedAt ? "Parado" : "Preparado");
    updateLiveStats();
    show("screen-work");
  }

  function renderHistory(){
    upsertPendingWorkInHistory();
    const hist = storage.get(LS.history, []);
    const filter = state.historyFilter || "all";
    const filtered = hist
      .map((w, originalIndex) => ({w, originalIndex}))
      .filter(({w}) => filter === "all" || (filter === "pending" ? !workIsCompleted(w) : workIsCompleted(w)));

    qsa("[data-history-filter]").forEach(btn => btn.classList.toggle("active", btn.dataset.historyFilter === filter));

    $("historyList").innerHTML = filtered.length ? filtered.map(({w, originalIndex}) => {
      const status = workHistoryStatus(w);
      const cls = status === "Pendiente" ? "pending" : "completed";
      const pendingButton = !workIsCompleted(w) ? `<button class="btn primary history-continue" data-history-continue="${originalIndex}">Continuar trabajo</button>` : "";
      return `
      <div class="history-card history-card-v11 history-entry">
        <button class="history-main" data-history-index="${originalIndex}">
          <span class="history-date">${escapeHtml(workHistoryDate(w))}</span>
          <strong>${escapeHtml(w.parcel || "Parcela sin nombre")}</strong>
          <span class="history-type">${escapeHtml(w.type || "Trabajo sin tipo")}</span>
          <span class="history-status ${cls}">${status}</span>
        </button>
        ${pendingButton}
      </div>`;
    }).join("") : `<div class="history-empty">${filter === "pending" ? "No hay trabajos pendientes." : filter === "completed" ? "No hay trabajos completados." : "No hay trabajos guardados."}</div>`;

    qsa("[data-history-index]").forEach(card => {
      card.addEventListener("click", () => {
        const latest = storage.get(LS.history, []);
        const w = latest[Number(card.dataset.historyIndex)];
        if(w) openReportForWork(w, "history");
      });
    });
    qsa("[data-history-continue]").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        resumePendingWorkFromHistory(Number(btn.dataset.historyContinue));
      });
    });
  }

  function restoreIfPossible(){
    const savedMap = storage.get(LS.map, null) || storage.get("pbgps_parcel_geojson_v07", null) || storage.get("pbgps_parcel_geojson_v06", null);
    if(savedMap && isValidParcelsGeoJSON(savedMap)){
      state.parcelsGeoJSON = savedMap;
      storage.set(LS.map, savedMap);
      renderParcelPreview(savedMap);
    }
    const savedIncidents = storage.get(LS.incidentLayer, null) || storage.get("pbgps_incident_layer_geojson_v07", null) || storage.get("pbgps_incident_layer_geojson_v06", null);
    if(savedIncidents && isValidIncidentsGeoJSON(savedIncidents)){
      state.incidentsGeoJSON = savedIncidents;
      storage.set(LS.incidentLayer, savedIncidents);
      renderIncidentLayerStatus(savedIncidents);
    }
  }

  function bind(){
    qsa("[data-go]").forEach(b => b.addEventListener("click", () => show(b.dataset.go)));
    qsa("[data-add-list]").forEach(b => b.addEventListener("click", () => addToList(b.dataset.addList)));
    qsa("[data-edit-list]").forEach(b => b.addEventListener("click", () => editListItem(b.dataset.editList)));
    qsa("[data-delete-list]").forEach(b => b.addEventListener("click", () => deleteListItem(b.dataset.deleteList)));
    qsa("[data-history-filter]").forEach(b => b.addEventListener("click", () => { state.historyFilter = b.dataset.historyFilter; renderHistory(); }));

    $("parcelGeojsonInput").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if(!file) return;
      try{
        const text = await file.text();
        const gj = JSON.parse(text);
        if(!isFeatureCollection(gj)) throw new Error("No es un GeoJSON FeatureCollection válido.");
        if(!isValidParcelsGeoJSON(gj)) throw new Error("No se detectaron polígonos de parcela. Si es INCIDENCIAS_.geojson, usa el segundo selector.");
        saveParcelsLayer(gj);
      }catch(err){
        $("mapLoadStatus").className = "status-card bad";
        $("mapLoadStatus").textContent = "PARCELAS.geojson no válido: " + err.message;
        updateContinueAvailability();
      }
    });

    $("incidentGeojsonInput").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if(!file) return;
      try{
        const text = await file.text();
        const gj = JSON.parse(text);
        if(!isValidIncidentsGeoJSON(gj)) throw new Error("No es un GeoJSON FeatureCollection válido.");
        saveIncidentsLayer(gj);
      }catch(err){
        $("incidentLayerStatus").className = "status-card bad";
        $("incidentLayerStatus").textContent = "INCIDENCIAS_.geojson no válido: " + err.message;
      }
    });

    $("continueAfterMap").onclick = () => show("screen-day-config");
    $("useSavedMap").onclick = () => {
      const gj = storage.get(LS.map, null) || storage.get("pbgps_parcel_geojson_v07", null) || storage.get("pbgps_parcel_geojson_v06", null);
      const inc = storage.get(LS.incidentLayer, null) || storage.get("pbgps_incident_layer_geojson_v07", null) || storage.get("pbgps_incident_layer_geojson_v06", null);
      if(isValidParcelsGeoJSON(gj)){
        state.parcelsGeoJSON = gj; storage.set(LS.map, gj); renderParcelPreview(gj);
        if(isValidIncidentsGeoJSON(inc)){ state.incidentsGeoJSON = inc; storage.set(LS.incidentLayer, inc); renderIncidentLayerStatus(inc); }
        show("screen-day-config");
      }
      else toast("No hay capa de parcelas guardada en este dispositivo.");
    };
    $("clearSavedMap").onclick = () => {
      if(confirm("¿Borrar las capas de parcelas e incidencias guardadas en este dispositivo?")){
        storage.remove(LS.map); storage.remove(LS.incidentLayer); state.parcelsGeoJSON = null; state.incidentsGeoJSON = null; location.reload();
      }
    };

    $("saveDayConfig").onclick = saveDayConfig;
    $("openHistoryFromDay").onclick = () => { upsertPendingWorkInHistory(); show("screen-history"); };
    $("reportBackBtn").onclick = () => {
      if(state.reportOrigin === "history") show("screen-history");
      else show("screen-work");
    };
    $("fitAllParcels").onclick = () => {
      const b = getBoundsFromGeoJSON(state.parcelsGeoJSON);
      if(b && state.maps.all) stabilizeMap(state.maps.all, b, [25,25]);
    };
    $("changeMapFile").onclick = () => show("screen-map-load");
    $("startWorkFlow").onclick = () => show("screen-work-type");
    $("openIncidentFromParcel").onclick = () => openIncident("parcel");
    qsa("[data-work-type]").forEach(b => b.addEventListener("click", () => chooseWorkType(b.dataset.workType)));

    $("runGpsCalibration").onclick = runGpsCalibration;
    $("startAfterCalibration").onclick = () => startWorkShell(false);
    $("forceStartWork").onclick = () => startWorkShell(true);

    $("beginWorkBtn").onclick = beginWork;
    $("stopWorkBtn").onclick = openStopModal;
    $("continueWorkBtn").onclick = continueWork;
    $("incidentWorkBtn").onclick = () => openIncident("work");
    $("viewDraftReportBtn").onclick = () => { state.reportWork = null; state.reportOrigin = "work"; resetReportTabs(); renderReport(); show("screen-report"); };
    $("backFromWork").onclick = () => {
      if(state.work && state.work.status !== "finalizado"){
        if(!confirm("Hay un trabajo en curso. ¿Volver sin finalizar?")) return;
        upsertPendingWorkInHistory();
      }
      show("screen-parcel-detail");
    };
    $("centerTractor").onclick = () => {
      state.trackingFollow = true;
      if(state.currentPos && state.maps.work) state.maps.work.setView([state.currentPos.lat, state.currentPos.lng], 19);
      else centerWorkMapOnTractor(true);
    };
    $("windReadingBtn").onclick = () => promptWindReading(false, "Registrar viento");

    $("cancelStopModal").onclick = closeStopModal;
    qsa("[data-stop-reason]").forEach(b => b.addEventListener("click", () => handleStop(b.dataset.stopReason)));

    $("cancelIncident").onclick = closeIncident;
    $("saveIncident").onclick = saveIncident;
    $("addIncidentType").onclick = addIncidentType;

    qsa("[data-report-tab]").forEach(b => b.addEventListener("click", () => {
      qsa(".tab").forEach(t=>t.classList.remove("active"));
      b.classList.add("active");
      const w = getReportWork();
      if(!w) return;
      renderReport();
    }));

    installReportGestures();

    $("clearHistory").onclick = () => {
      if(!confirm("ATENCIÓN: vas a borrar todo el historial local de trabajos de este dispositivo. ¿Continuar?")) return;
      const text = prompt("Para confirmar, escribe exactamente BORRAR:");
      if(text !== "BORRAR") { toast("Borrado cancelado."); return; }
      if(!confirm("Última confirmación: esta acción no se puede deshacer. ¿Borrar historial local?")) return;
      storage.remove(LS.history);
      renderHistory();
    };
  }

  function installReportGestures(){
    const host = $("reportContent");
    if(!host || host.dataset.swipeReady === "1") return;
    let startX = 0, startY = 0, startT = 0;
    host.addEventListener("touchstart", ev => {
      const t = ev.touches?.[0];
      if(!t) return;
      startX = t.clientX; startY = t.clientY; startT = Date.now();
    }, {passive:true});
    host.addEventListener("touchend", ev => {
      const t = ev.changedTouches?.[0];
      if(!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startT;
      if(dt > 700) return;
      if(Math.abs(dx) < 60) return;
      if(Math.abs(dx) < Math.abs(dy) * 1.4) return;
      moveReportTab(dx < 0 ? 1 : -1);
    }, {passive:true});
    host.dataset.swipeReady = "1";
  }

  function init(){
    setAppHeight();
    window.addEventListener("resize", setAppHeight);
    window.addEventListener("orientationchange", () => setTimeout(setAppHeight, 250));
    initLists();
    loadSavedDayConfig();
    bind();
    restoreIfPossible();

    setTimeout(() => {
      const gj = storage.get(LS.map, null) || storage.get("pbgps_parcel_geojson_v07", null) || storage.get("pbgps_parcel_geojson_v06", null);
      const inc = storage.get(LS.incidentLayer, null) || storage.get("pbgps_incident_layer_geojson_v07", null) || storage.get("pbgps_incident_layer_geojson_v06", null);
      if(isValidParcelsGeoJSON(gj)) { state.parcelsGeoJSON = gj; storage.set(LS.map, gj); renderParcelPreview(gj); }
      if(isValidIncidentsGeoJSON(inc)) { state.incidentsGeoJSON = inc; storage.set(LS.incidentLayer, inc); renderIncidentLayerStatus(inc); }
      show("screen-map-load");
    }, 4000);
  }

  window.addEventListener("load", init);
})();