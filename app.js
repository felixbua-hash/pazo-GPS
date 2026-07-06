(() => {
  "use strict";

  const VERSION = "Beta 3.0";
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
      if(b.isValid()) stabilizeMap(map, b, [42,42]);
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
      state.layers.workParcel = L.geoJSON(state.selectedFeature, { style: parcelStyle(true) }).addTo(map).bringToFront();
      drawImportedIncidents(map, "workImportedIncidents");
      const b = state.layers.workParcel.getBounds();
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

  function beginWork(){
    if(!state.work) return;
    state.work.status = "trabajando";
    state.work.startedAt = Date.now();
    state.work.lastSegmentAt = Date.now();
    state.work.nextWindPromptAt = Date.now() + 30*60*1000;
    addEvent("Comienzo", "Punto inicial", "Inicio del trabajo");
    $("beginWorkBtn").classList.add("hidden");
    $("stopWorkBtn").classList.remove("hidden");
    $("continueWorkBtn").classList.add("hidden");
    setWorkStateUi("Trabajando");
    state.trackingFollow = true;
    startGpsWatch();
    centerWorkMapOnTractor(true);
    setTimeout(() => promptWindReading(false, "Registrar viento inicial"), 600);
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

  function formatWind(kmh){
    if(kmh === null || kmh === undefined || !isFinite(kmh)) return "—";
    const n = Number(kmh);
    return `${n.toFixed(n >= 10 ? 0 : 1).replace(".", ",")} km/h`;
  }

  function windStats(readings){
    const arr = (readings || []).map(r => Number(r.kmh)).filter(v => isFinite(v));
    if(!arr.length) return { latest:null, avg:null, max:null, count:0 };
    return {
      latest: arr[arr.length-1],
      avg: arr.reduce((a,b)=>a+b,0)/arr.length,
      max: Math.max(...arr),
      count: arr.length
    };
  }

  function updateWindUi(){
    const el = $("windSpeedValue");
    if(!el) return;
    const stats = windStats(state.work?.windReadings || []);
    el.textContent = formatWind(stats.latest);
  }

  function promptWindReading(auto=false, title="Registrar viento"){
    if(!state.work) return;
    if(state.windPromptOpen) return;
    state.windPromptOpen = true;
    try{
      const stats = windStats(state.work.windReadings || []);
      const base = stats.latest !== null ? String(stats.latest).replace(".", ",") : "";
      const raw = prompt(`${title}. Velocidad del viento en km/h:`, base);
      state.work.nextWindPromptAt = Date.now() + 30*60*1000;
      if(raw === null || String(raw).trim() === ""){
        storage.set(LS.active, state.work);
        return;
      }
      const value = Number(String(raw).replace(",", "."));
      if(!isFinite(value) || value < 0 || value > 150){
        toast("Valor de viento no válido. Introduce km/h entre 0 y 150.");
        storage.set(LS.active, state.work);
        return;
      }
      const reading = {
        at: new Date().toISOString(),
        timeLabel: new Date().toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}),
        kmh: value,
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
    if(!state.work || state.work.status !== "trabajando") return;
    if(!state.work.nextWindPromptAt) state.work.nextWindPromptAt = Date.now() + 30*60*1000;
    if(Date.now() >= state.work.nextWindPromptAt) promptWindReading(true, "Registro periódico de viento");
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
      state.work.status = "finalizado";
      state.work.finishedAt = now;
      state.work.activeMs += now - (state.work.lastSegmentAt || now);
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
    if(!state.work || state.work.status !== "parado") return;
    const now = Date.now();
    if(state.work.pausedAt) state.work.stoppedMs += now - state.work.pausedAt;
    addEvent("Continuar", "Reanudación", "Continúa el trabajo");
    state.work.status = "trabajando";
    state.work.lastSegmentAt = now;
    $("stopWorkBtn").classList.remove("hidden");
    $("continueWorkBtn").classList.add("hidden");
    setWorkStateUi("Trabajando");
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

  function resetReportTabs(){
    qsa(".tab").forEach(t => t.classList.remove("active"));
    const first = document.querySelector('[data-report-tab="summary"]');
    if(first) first.classList.add("active");
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

  function renderReport(){
    const w = getReportWork();
    if(!w){
      $("reportContent").innerHTML = reportEmpty("No hay trabajo para informar.");
      $("reportMap").classList.add("hidden");
      return;
    }

    $("reportSubtitle").textContent = `${w.parcel} · ${w.type}`;
    $("reportStatusChip").textContent = w.status === "finalizado" ? "Informe definitivo" : "Resumen provisional";
    $("reportStatusChip").style.background = w.status === "finalizado" ? "#eaf6e9" : "#fff4e6";
    $("reportStatusChip").style.color = w.status === "finalizado" ? "#2f7d44" : "#8b520e";
    $("reportTotal").textContent = fmtTime(reportTotalMs(w));
    $("reportDistance").textContent = ((w.distanceM || 0)/1000).toFixed(2).replace(".", ",") + " km";
    $("reportRefills").textContent = String(w.refills || 0);
    const ws = windStats(w.windReadings || []);
    $("reportWind").textContent = ws.latest === null ? "—" : formatWind(ws.latest);

    renderReportSummary(w);
    const hasMapData = (w.pointsClean || []).length > 1 || (w.events || []).some(e=>e.lat && e.lng) || (w.incidents || []).some(i=>i.lat && i.lng);
    if(hasMapData) renderReportMap(w); else $("reportMap").classList.add("hidden");
  }

  function renderReportMap(w){
    const el = $("reportMap");
    el.classList.remove("hidden");
    if(state.maps.report){
      state.maps.report.remove();
      state.maps.report = null;
    }
    el.innerHTML = "";
    if(!ensureLeaflet()){
      el.classList.add("hidden");
      return;
    }
    const map = L.map(el, { zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, tap:false });
    state.maps.report = map;
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom:20 }).addTo(map);
    const reportFeature = w.parcelFeature || findParcelFeatureByName(w.parcel) || (w.parcel === state.selectedParcelName ? state.selectedFeature : null);
    let bounds = null;
    if(reportFeature) {
      const lyr = L.geoJSON(reportFeature, { style: parcelStyle(true) }).addTo(map).bringToFront();
      bounds = lyr.getBounds();
    }
    drawImportedIncidents(map, "reportImportedIncidents");
    const pts = (w.pointsClean || []).map(p=>[p.lat,p.lng]);
    if(pts.length > 1) {
      const route = L.polyline(pts, {color:"#1f7ed0",weight:4}).addTo(map);
      bounds = bounds && bounds.isValid() ? bounds.extend(route.getBounds()) : route.getBounds();
    }
    (w.events || []).forEach(ev => {
      if(ev.lat && ev.lng) L.circleMarker([ev.lat,ev.lng], {radius:6,color:"#fff",weight:2,fillColor:ev.type.includes("Fin")?"#a8483a":ev.type==="Comienzo"?"#2f7d44":"#c47b32",fillOpacity:1}).addTo(map);
    });
    (w.incidents || []).forEach(inc => {
      if(inc.lat && inc.lng) L.circleMarker([inc.lat,inc.lng], {radius:6,color:"#fff",weight:2,fillColor:getIncidentColor(inc.type),fillOpacity:1}).addTo(map);
    });
    if(bounds && bounds.isValid()) stabilizeMap(map, bounds, [18,18]);
    else stabilizeMap(map, null, [18,18]);
  }

  function reportWarning(w){
    const gps = w.gpsStats || {};
    if(w.forcedStart || gps.discarded > 0 || (gps.worst && gps.worst > 15)){
      return `<div class="report-warning"><strong>Advertencia GPS:</strong> el trazado debe interpretarse como aproximado en algunos tramos. Se conservaron los puntos originales y se generó una ruta depurada para visualización e informe.</div>`;
    }
    return "";
  }

  function reportToMs(value){
    if(value === null || value === undefined || value === "") return null;
    if(typeof value === "number" && isFinite(value)) return value;
    const n = Number(value);
    if(isFinite(n) && String(value).length >= 10) return n;
    const d = new Date(value);
    const t = d.getTime();
    return isNaN(t) ? null : t;
  }

  function reportEventMs(ev){
    return reportToMs(ev?.at || ev?.time || ev?.timestamp || null);
  }

  function fmtReportHm(ms){
    if(!isFinite(ms) || ms < 0) ms = 0;
    const totalMinutes = Math.round(ms / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  }

  function fmtReportDurationText(ms){
    if(!isFinite(ms) || ms < 0) ms = 0;
    const totalMinutes = Math.round(ms / 60000);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const hText = h === 1 ? "1 hora" : `${h} horas`;
    const mText = m === 1 ? "1 minuto" : `${m} minutos`;
    if(h <= 0) return mText;
    if(m <= 0) return hText;
    return `${hText} ${mText}`;
  }

  function reportDateLabel(ms){
    return isFinite(ms) ? new Date(ms).toLocaleDateString("es-ES", {day:"2-digit", month:"2-digit", year:"numeric"}) : "—";
  }

  function reportTimeLabel(ms){
    return isFinite(ms) ? new Date(ms).toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}) : "—";
  }

  function reportColorClass(i){
    return ["green", "gold", "red"][i % 3];
  }

  function reportIcon(name){
    const icons = {
      wind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h9a3 3 0 1 0-3-3"/><path d="M4 13h13a3 3 0 1 1-3 3"/><path d="M4 18h6"/></svg>',
      stopwatch: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M12 13l3-3"/><path d="M9 2h6"/><path d="M12 2v3"/></svg>',
      pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M10 8v8"/><path d="M14 8v8"/></svg>',
      users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/><circle cx="5" cy="10" r="2"/><path d="M2 20v-1a4 4 0 0 1 4-4"/><circle cx="19" cy="10" r="2"/><path d="M22 20v-1a4 4 0 0 0-4-4"/></svg>',
      battery: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="16" height="8" rx="2"/><path d="M21 11v2"/></svg>',
      clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v6l4 2"/></svg>',
      calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="15" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M5 10h14"/></svg>',
      clipboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M9 14l2 2 4-5"/></svg>',
      info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/></svg>',
      leaf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4c-7 0-12 4-12 10 0 3 2 5 5 5 6 0 9-7 7-15z"/><path d="M4 20c4-6 8-9 14-13"/><path d="M10 15l-3 3"/></svg>'
    };
    return icons[name] || "";
  }

  function reportSessions(w){
    const events = (w.events || [])
      .map(ev => ({...ev, ms: reportEventMs(ev)}))
      .filter(ev => isFinite(ev.ms))
      .sort((a,b) => a.ms - b.ms);
    const segments = [];
    let current = null;

    events.forEach(ev => {
      const type = String(ev.type || "");
      const isStart = type === "Comienzo" || type === "Continuar";
      const isEnd = type === "Parada" || type.includes("Fin");
      if(isStart){
        if(current && !current.endMs){
          current.endMs = ev.ms;
          current.end = ev;
          segments.push(current);
        }
        current = { start: ev, startMs: ev.ms, end: null, endMs: null };
      } else if(isEnd && current){
        current.end = ev;
        current.endMs = ev.ms;
        segments.push(current);
        current = null;
      }
    });

    if(current){
      current.endMs = reportToMs(w.finishedAt) || Date.now();
      current.end = null;
      segments.push(current);
    }

    if(!segments.length && w.startedAt){
      const startMs = reportToMs(w.startedAt);
      const endMs = reportToMs(w.finishedAt) || Date.now();
      if(isFinite(startMs) && isFinite(endMs)) segments.push({ start:null, startMs, end:null, endMs });
    }

    const mapped = segments.map((seg, i) => {
      const startMs = seg.startMs;
      const endMs = Math.max(seg.endMs || startMs, startMs);
      const nextStart = segments[i+1]?.startMs || null;
      const stoppedMs = nextStart ? Math.max(0, nextStart - endMs) : 0;
      return {
        index: i + 1,
        color: reportColorClass(i),
        date: reportDateLabel(startMs),
        start: reportTimeLabel(startMs),
        end: reportTimeLabel(endMs),
        activeMs: Math.max(0, endMs - startMs),
        stoppedMs
      };
    });

    const totalStopped = Math.max(0, w.stoppedMs || 0);
    const sumStopped = mapped.reduce((a,s) => a + (s.stoppedMs || 0), 0);
    const residualStopped = Math.max(0, totalStopped - sumStopped);
    if(residualStopped && mapped.length) mapped[mapped.length - 1].stoppedMs += residualStopped;
    return mapped;
  }

  function renderReportSummary(w){
    const sessions = reportSessions(w);
    const activeMs = reportEffectiveActiveMs(w);
    const stoppedMs = Math.max(0, w.stoppedMs || 0);
    const sessionCount = sessions.length;
    const sessionsLabel = sessionCount === 1 ? "una sesión" : `${sessionCount || 0} sesiones`;
    const legendHtml = sessions.map((s, i) => `
      <span class="pb3-legend-item"><i class="${s.color}"></i><b>Sesión ${i + 1}</b><strong>${fmtReportHm(s.activeMs)}</strong></span>
      ${i < sessions.length - 1 ? '<span class="pb3-legend-sep">·</span>' : ''}
    `).join("");

    const sessionRows = sessions.map((s, i) => `
      <div class="pb3-timeline-row ${s.color}">
        <div class="pb3-marker">${i + 1}</div>
        <div class="pb3-session-card">
          <div class="pb3-date-cell"><span class="pb3-row-icon">${reportIcon("calendar")}</span><strong>${escapeHtml(s.date)}</strong></div>
          <div class="pb3-time-cell"><span class="pb3-row-icon">${reportIcon("clock")}</span><strong>${escapeHtml(s.start)}</strong><small>Inicio</small></div>
          <div class="pb3-arrow">→</div>
          <div class="pb3-time-cell"><span class="pb3-row-icon">${reportIcon("clock")}</span><strong>${escapeHtml(s.end)}</strong><small>Fin</small></div>
          <div class="pb3-active-cell"><span class="pb3-row-icon">${reportIcon("stopwatch")}</span><strong>${fmtReportHm(s.activeMs)}</strong><small>Activo</small></div>
        </div>
      </div>
    `).join("");

    const detailRows = sessions.map(s => `
      <tr class="${s.color}">
        <td><i></i></td>
        <td>${escapeHtml(s.date)}</td>
        <td>${escapeHtml(s.start)}</td>
        <td>${escapeHtml(s.end)}</td>
        <td>${fmtReportHm(s.activeMs)}</td>
        <td>${fmtReportHm(s.stoppedMs)}</td>
      </tr>
    `).join("");

    const empty = !w.startedAt && !(w.events || []).length;
    const conclusion = empty
      ? "El informe se completará cuando se inicie y finalice el trabajo en la parcela."
      : `La parcela ${w.status === "finalizado" ? "se completó" : "está registrada"} en ${sessionsLabel} de trabajo.<br>El tiempo total de aplicación efectiva fue de ${fmtReportDurationText(activeMs)}.`;

    $("reportContent").innerHTML = `
      <div class="pb3-report-scroll">
        ${reportWarning(w)}
        <section class="pb3-card pb3-summary-card">
          <h2><span class="pb3-title-icon gold">${reportIcon("wind")}</span>Resumen de trabajo</h2>
          <div class="pb3-metric-grid">
            <div class="pb3-metric green"><span>${reportIcon("stopwatch")}</span><small>Tiempo activo</small><strong>${fmtReportHm(activeMs)}</strong></div>
            <div class="pb3-metric gold"><span>${reportIcon("pause")}</span><small>Tiempo parado</small><strong>${fmtReportHm(stoppedMs)}</strong></div>
            <div class="pb3-metric green"><span>${reportIcon("users")}</span><small>Sesiones</small><strong>${sessionCount || 0}</strong></div>
            <div class="pb3-metric gold"><span>${reportIcon("battery")}</span><small>Recargas</small><strong>${w.refills || 0}</strong></div>
          </div>
          <div class="pb3-legend">${legendHtml || '<span class="pb3-empty-inline">Sin sesiones registradas</span>'}</div>
        </section>

        <section class="pb3-card pb3-sessions-card">
          <h2><span class="pb3-title-icon gold">${reportIcon("clock")}</span>Sesiones de trabajo</h2>
          <div class="pb3-timeline">
            <div class="pb3-line"></div>
            ${sessionRows || '<div class="pb3-empty-block">Sin sesiones de trabajo registradas todavía.</div>'}
          </div>
        </section>

        <section class="pb3-card pb3-detail-card">
          <h2><span class="pb3-title-icon gold">${reportIcon("clock")}</span>Detalle por sesiones</h2>
          <table class="pb3-detail-table">
            <thead><tr><th></th><th>Fecha</th><th>Inicio</th><th>Fin</th><th>Activo</th><th>Parado</th></tr></thead>
            <tbody>${detailRows || '<tr><td colspan="6">Sin datos registrados.</td></tr>'}</tbody>
          </table>
        </section>

        <section class="pb3-conclusion-card">
          <div>
            <h2><span class="pb3-title-icon green">${reportIcon("clipboard")}</span>Conclusión</h2>
            <p>${conclusion}</p>
          </div>
          <span class="pb3-leaf">${reportIcon("leaf")}</span>
        </section>

        <section class="pb3-weather-note">
          <span>${reportIcon("info")}</span>
          <p>Dato procedente de pronóstico meteorológico,<br>no de medición directa en parcela.</p>
        </section>
      </div>
    `;
  }

  function renderReportWork(w){
    const avg = reportAverageSpeed(w);
    const started = w.startedAt ? new Date(w.startedAt).toLocaleString("es-ES") : "—";
    const finished = w.finishedAt ? new Date(w.finishedAt).toLocaleString("es-ES") : "—";
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        <div class="report-section-title">Tiempos y recorrido</div>
        <div class="report-grid">
          ${reportKpi("Tiempo total", fmtTime(reportTotalMs(w)))}
          ${reportKpi("Tiempo efectivo", fmtTime(reportEffectiveActiveMs(w)))}
          ${reportKpi("Tiempo parado", fmtTime(w.stoppedMs || 0))}
          ${reportKpi("Velocidad media", avg === null ? "—" : avg.toFixed(1).replace(".", ",") + " km/h")}
          ${reportKpi("Distancia", ((w.distanceM || 0)/1000).toFixed(2).replace(".", ",") + " km")}
          ${reportKpi("Paradas", String(w.stops || 0))}
          ${reportKpi("Recargas", String(w.refills || 0))}
          ${reportKpi("Incidencias", String((w.incidents || []).length))}
        </div>
        <div class="report-section-title">Inicio y fin</div>
        <div class="report-list">
          <div><span>Inicio</span><strong>${escapeHtml(started)}</strong></div>
          <div><span>Fin</span><strong>${escapeHtml(finished)}</strong></div>
        </div>
      </div>`;
  }

  function renderReportEvents(w){
    const events = w.events || [];
    const rows = events.map(ev => `<div class="report-event"><strong>${escapeHtml(ev.type)}</strong><span>${escapeHtml(ev.timeLabel || "—")} · ${escapeHtml(ev.label || "—")}</span><small>GPS ${formatMeters(ev.accuracy)}${ev.notes ? " · " + escapeHtml(ev.notes) : ""}</small></div>`).join("");
    $("reportContent").innerHTML = `<div class="scroll-box report-visual"><div class="report-section-title">Eventos del trabajo</div>${rows || reportEmpty("Sin eventos registrados todavía.")}</div>`;
  }

  function renderReportIncidents(w){
    const incidents = w.incidents || [];
    const rows = incidents.map(i => `<div class="report-event"><strong>${escapeHtml(i.type)}</strong><span>${escapeHtml(i.timeLabel || "—")} · ${escapeHtml(i.status || "—")}</span><small>GPS ${formatMeters(i.accuracy)}${i.gpsMissing ? " · Sin coordenada" : ""}${i.notes ? " · " + escapeHtml(i.notes) : ""}</small>${i.photo ? `<img class="incident-thumb" src="${i.photo}" alt="Foto incidencia" />` : ""}</div>`).join("");
    $("reportContent").innerHTML = `<div class="scroll-box report-visual"><div class="report-section-title">Incidencias</div>${rows || reportEmpty("Sin incidencias registradas.")}</div>`;
  }

  function renderReportGps(w){
    const cal = w.gpsCalibration || {};
    const gps = w.gpsStats || {};
    const avgAcc = gps.count ? (gps.sum / gps.count) : null;
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        ${reportWarning(w)}
        <div class="report-section-title">Calidad GPS</div>
        <div class="report-grid">
          ${reportKpi("Calibración", cal.quality || "—")}
          ${reportKpi("Mejor previa", formatMeters(cal.best))}
          ${reportKpi("Media previa", formatMeters(cal.avg))}
          ${reportKpi("Inicio forzado", w.forcedStart ? "Sí" : "No")}
          ${reportKpi("Media trabajo", formatMeters(avgAcc))}
          ${reportKpi("Peor trabajo", formatMeters(gps.worst))}
          ${reportKpi("Puntos originales", String((w.pointsOriginal || []).length))}
          ${reportKpi("Ruta depurada", String((w.pointsClean || []).length))}
          ${reportKpi("Dudosos", String(gps.doubtful || 0))}
          ${reportKpi("Descartados", String(gps.discarded || 0))}
        </div>
      </div>`;
  }

  function renderReportWind(w){
    const readings = w.windReadings || [];
    const ws = windStats(readings);
    const rows = readings.map(r => `<div class="report-event"><strong>${formatWind(r.kmh)}</strong><span>${escapeHtml(r.timeLabel || "—")}</span><small>${r.autoPrompt ? "Registro periódico" : "Registro manual/inicial"}</small></div>`).join("");
    const warning = ws.max !== null && ws.max >= 20 ? `<div class="report-warning"><strong>Aviso viento:</strong> se registró un valor máximo de ${formatWind(ws.max)}. Revisar idoneidad de aplicación según criterio técnico y normativa aplicable.</div>` : "";
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        ${warning}
        <div class="report-section-title">Viento durante la aplicación</div>
        <div class="report-grid">
          ${reportKpi("Último", ws.latest === null ? "—" : formatWind(ws.latest))}
          ${reportKpi("Media", ws.avg === null ? "—" : formatWind(ws.avg))}
          ${reportKpi("Máximo", ws.max === null ? "—" : formatWind(ws.max))}
          ${reportKpi("Registros", String(ws.count))}
        </div>
        <div class="report-section-title">Registros cada 30 minutos</div>
        ${rows || reportEmpty("Sin registros de viento. Durante el trabajo la app pedirá el dato cada 30 minutos y también puede registrarse tocando la tarjeta Viento.")}
      </div>`;
  }

  function renderReportExport(w){
    $("reportContent").innerHTML = `
      <div class="scroll-box export-grid report-visual">
        <button class="btn primary full" id="shareReport">Compartir resumen</button>
        <button class="btn ghost full" id="downloadJson">Exportar JSON completo</button>
        <button class="btn ghost full" id="downloadCsv">Exportar CSV eventos</button>
        <button class="btn ghost full" id="downloadWindCsv">Exportar CSV viento</button>
        <button class="btn ghost full" id="downloadGeojson">Exportar ruta GeoJSON</button>
        <button class="btn ghost full" id="downloadGpx">Exportar ruta GPX</button>
        <button class="btn ghost full" id="downloadKml">Exportar ruta KML</button>
        <button class="btn ghost full" id="printReport">Imprimir / Guardar PDF</button>
        <p>Los archivos se generan localmente desde este dispositivo.</p>
      </div>`;
    $("shareReport").onclick = () => shareReportSummary(w);
    $("downloadJson").onclick = () => downloadBlob(safeFilename(w, "trabajo", "json"), JSON.stringify(w, null, 2), "application/json");
    $("downloadCsv").onclick = () => exportEventsCsv(w);
    $("downloadWindCsv").onclick = () => exportWindCsv(w);
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
    const header = "hora,kmh,tipo_registro\n";
    const rows = (w.windReadings || []).map(r => [r.timeLabel, r.kmh, r.autoPrompt ? "periodico" : "manual"].map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
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
    const snap = serializeWork({...state.work, status:"pendiente"});
    const idx = hist.findIndex(w => w.id === snap.id);
    if(idx >= 0) hist[idx] = snap;
    else hist.unshift(snap);
    storage.set(LS.history, hist.slice(0, 200));
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
      return `
      <button class="history-card history-button history-card-v11" data-history-index="${originalIndex}">
        <span class="history-date">${escapeHtml(workHistoryDate(w))}</span>
        <strong>${escapeHtml(w.parcel || "Parcela sin nombre")}</strong>
        <span class="history-type">${escapeHtml(w.type || "Trabajo sin tipo")}</span>
        <span class="history-status ${cls}">${status}</span>
      </button>`;
    }).join("") : `<div class="history-empty">${filter === "pending" ? "No hay trabajos pendientes." : filter === "completed" ? "No hay trabajos completados." : "No hay trabajos guardados."}</div>`;

    qsa("[data-history-index]").forEach(card => {
      card.addEventListener("click", () => {
        const latest = storage.get(LS.history, []);
        const w = latest[Number(card.dataset.historyIndex)];
        if(w) openReportForWork(w, "history");
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
      if(b.dataset.reportTab === "summary") renderReportSummary(w);
      if(b.dataset.reportTab === "work") renderReportWork(w);
      if(b.dataset.reportTab === "events") renderReportEvents(w);
      if(b.dataset.reportTab === "gps") renderReportGps(w);
      if(b.dataset.reportTab === "wind") renderReportWind(w);
      if(b.dataset.reportTab === "incidents") renderReportIncidents(w);
      if(b.dataset.reportTab === "export") renderReportExport(w);
    }));

    $("clearHistory").onclick = () => {
      if(!confirm("ATENCIÓN: vas a borrar todo el historial local de trabajos de este dispositivo. ¿Continuar?")) return;
      const text = prompt("Para confirmar, escribe exactamente BORRAR:");
      if(text !== "BORRAR") { toast("Borrado cancelado."); return; }
      if(!confirm("Última confirmación: esta acción no se puede deshacer. ¿Borrar historial local?")) return;
      storage.remove(LS.history);
      renderHistory();
    };
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