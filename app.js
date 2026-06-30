(() => {
  "use strict";

  const VERSION = "Beta 1.4";
  const LS = {
    map: "pbgps_parcel_geojson_v08",
    incidentLayer: "pbgps_incident_layer_geojson_v08",
    lists: "pbgps_lists_v08",
    day: "pbgps_day_config_v08",
    history: "pbgps_history_v08",
    incidents: "pbgps_incidents_v08",
    active: "pbgps_active_work_v08"
  };

  const WIND = {
    intervalMs: 30 * 60 * 1000,
    provider: "Open-Meteo",
    recommendedKmh: 10.8,
    cautionKmh: 15.3
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


  function workUsesWind(work=state.work){
    const type = work?.type || state.workType || "";
    return type === "Aplicación de fitosanitarios";
  }

  function syncWindVisibility(work=state.work){
    const usesWind = workUsesWind(work);
    if($("windReadingBtn")) $("windReadingBtn").classList.toggle("hidden", !usesWind);
    if($("reportWindCard")) $("reportWindCard").classList.toggle("hidden", !usesWind);
    if($("reportWindTab")) $("reportWindTab").classList.toggle("hidden", !usesWind);
    if(!usesWind && $("windSpeedValue")) $("windSpeedValue").textContent = "—";
  }

  function levelClass(label){
    if(label === "Exceso" || label === "Rojo" || label === "Insuficiente" || label === "Mala") return "bad";
    if(label === "Precaución" || label === "Ámbar" || label === "Aceptable") return "warn";
    return "ok";
  }

  function levelColor(label){
    if(levelClass(label) === "bad") return "#c24a3f";
    if(levelClass(label) === "warn") return "#d8a52d";
    return "#5d9b46";
  }

  function statePill(label){
    const cls = levelClass(label);
    return `<span class="state-pill ${cls === "warn" ? "warn" : cls === "bad" ? "bad" : ""}"><span class="report-dot ${cls === "warn" ? "warn" : cls === "bad" ? "bad" : ""}"></span>${escapeHtml(label || "—")}</span>`;
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
      sessions: [],
      currentSessionId: null,
      windReadings: [],
      nextWindPromptAt: null,
      windSource: { provider: WIND.provider, type: "Pronóstico meteorológico", note: "Dato procedente de pronóstico meteorológico, no de medición directa en parcela." },
      forcedStart: forced
    };
    storage.set(LS.active, state.work);
    state.reportWork = null;
    state.reportOrigin = "work";
    resetLiveUi();
    show("screen-work");
    setTimeout(() => syncWindVisibility(state.work), 0);
  }

  function setupWorkMap(){
    if(!state.work) return;
    syncWindVisibility(state.work);
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

  function ensureSessions(w){
    if(!w) return [];
    if(!Array.isArray(w.sessions)) w.sessions = [];
    return w.sessions;
  }

  function currentSession(w=state.work){
    if(!w) return null;
    ensureSessions(w);
    return w.sessions.find(s => s.id === w.currentSessionId) || null;
  }

  function startNewSession(kind="inicio"){
    if(!state.work) return null;
    const now = Date.now();
    ensureSessions(state.work);
    const session = {
      id: "sesion-" + now,
      date: todayIso(),
      startedAt: now,
      finishedAt: null,
      activeMs: 0,
      stoppedMs: 0,
      refills: 0,
      stops: 0,
      kind,
      day: state.dayConfig || storage.get(LS.day, {}) || {},
      notes: kind === "continuacion" ? "Continuación de trabajo pendiente" : "Primera sesión"
    };
    state.work.sessions.push(session);
    state.work.currentSessionId = session.id;
    return session;
  }

  function addActiveToCurrentSession(ms){
    const session = currentSession();
    if(session && isFinite(ms) && ms > 0) session.activeMs = (session.activeMs || 0) + ms;
  }

  function addStoppedToCurrentSession(ms){
    const session = currentSession();
    if(session && isFinite(ms) && ms > 0) session.stoppedMs = (session.stoppedMs || 0) + ms;
  }

  function finishCurrentSession(now=Date.now()){
    const session = currentSession();
    if(session && !session.finishedAt) session.finishedAt = now;
    if(state.work) state.work.currentSessionId = null;
  }

  function resumeWorkUi(){
    if(!state.work) return;
    $("beginWorkBtn").classList.add("hidden");
    $("stopWorkBtn").classList.add("hidden");
    $("continueWorkBtn").classList.remove("hidden");
    setWorkStateUi("Parado");
    $("distanceKm").textContent = ((state.work.distanceM || 0)/1000).toFixed(2).replace(".", ",");
    $("refillCount").textContent = String(state.work.refills || 0);
    updateWindUi();
    if(!state.tickerStarted){ state.tickerStarted = true; tick(); }
  }

  function suspendWorkAsPending(){
    if(!state.work || workIsCompleted(state.work)) return;
    const now = Date.now();
    if(state.work.status === "trabajando"){
      const ms = now - (state.work.lastSegmentAt || now);
      state.work.activeMs += ms;
      addActiveToCurrentSession(ms);
      try{ addEvent("Pausa de jornada", "Trabajo pendiente", "La parcela queda pendiente para continuar en otra sesión."); }catch{}
    } else if(state.work.status === "parado" && state.work.pausedAt){
      const ms = now - state.work.pausedAt;
      state.work.stoppedMs += ms;
      addStoppedToCurrentSession(ms);
    }
    finishCurrentSession(now);
    state.work.status = "pendiente";
    state.work.lastSegmentAt = null;
    state.work.pausedAt = null;
    state.work.nextWindPromptAt = null;
    stopGpsWatch();
  }

  function beginWork(){
    if(!state.work) return;
    if(state.work.startedAt){
      continueWork();
      return;
    }
    const now = Date.now();
    state.work.status = "trabajando";
    state.work.startedAt = now;
    state.work.lastSegmentAt = now;
    state.work.nextWindPromptAt = now + WIND.intervalMs;
    startNewSession("inicio");
    addEvent("Comienzo", "Punto inicial", "Inicio del trabajo");
    $("beginWorkBtn").classList.add("hidden");
    $("stopWorkBtn").classList.remove("hidden");
    $("continueWorkBtn").classList.add("hidden");
    setWorkStateUi("Trabajando");
    state.trackingFollow = true;
    startGpsWatch();
    centerWorkMapOnTractor(true);
    if(workUsesWind(state.work)) setTimeout(() => captureWindForecast(false, "Viento previsto inicial"), 900);
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

  function windDirectionLabel(deg){
    if(deg === null || deg === undefined || !isFinite(Number(deg))) return "—";
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
    return dirs[Math.round((Number(deg) % 360) / 22.5) % 16];
  }

    function windLevel(speed, gust){
    const value = Math.max(Number(speed) || 0, Number(gust) || 0);
    if(value > WIND.cautionKmh) return { label:"Exceso", cls:"bad" };
    if(value > WIND.recommendedKmh) return { label:"Precaución", cls:"warn" };
    return { label:"Recomendado", cls:"ok" };
  }

  function windStats(readings){
    const arr = (readings || []).map(r => Number(r.kmh)).filter(v => isFinite(v));
    const gusts = (readings || []).map(r => Number(r.gustKmh)).filter(v => isFinite(v));
    const warnings = (readings || []).filter(r => ["Precaución","Exceso"].includes(r.level)).length;
    const directions = (readings || []).map(r => r.direction).filter(Boolean);
    const latestReading = (readings || []).slice().reverse().find(r => isFinite(Number(r.kmh))) || null;
    const dominant = directions.length ? directions.sort((a,b)=>directions.filter(v=>v===b).length-directions.filter(v=>v===a).length)[0] : null;
    if(!arr.length) return { latest:null, latestReading:null, avg:null, max:null, maxGust:null, count:0, warnings, dominant:null };
    return {
      latest: arr[arr.length-1],
      latestReading,
      avg: arr.reduce((a,b)=>a+b,0)/arr.length,
      max: Math.max(...arr),
      maxGust: gusts.length ? Math.max(...gusts) : null,
      count: arr.length,
      warnings,
      dominant
    };
  }

    function updateWindUi(){
    const el = $("windSpeedValue");
    if(!el) return;
    if(!workUsesWind(state.work)){ el.textContent = "—"; return; }
    const stats = windStats(state.work?.windReadings || []);
    if(!stats.latestReading){ el.textContent = "—"; return; }
    const r = stats.latestReading;
    el.textContent = `${formatWind(r.kmh)} · ${r.direction || "—"}`;
  }

  function getFeatureCenter(feature){
    if(!feature || !window.L) return null;
    try{
      const b = L.geoJSON(feature).getBounds();
      if(b && b.isValid()){
        const c = b.getCenter();
        return {lat:c.lat, lng:c.lng};
      }
    }catch{}
    return null;
  }

  function getWindReferencePosition(){
    const last = state.currentPos || state.work?.pointsClean?.at?.(-1) || state.work?.pointsOriginal?.at?.(-1);
    if(last && isFinite(last.lat) && isFinite(last.lng)) return {lat:last.lat, lng:last.lng};
    const f = state.work?.parcelFeature || state.selectedFeature || findParcelFeatureByName(state.work?.parcel);
    return getFeatureCenter(f);
  }

  function nearestHourlyIndex(times, targetMs){
    let best = 0, bestDelta = Infinity;
    (times || []).forEach((t, i) => {
      const ms = new Date(t).getTime();
      const d = Math.abs(ms - targetMs);
      if(isFinite(d) && d < bestDelta){ bestDelta = d; best = i; }
    });
    return best;
  }

  async function fetchForecastWind(){
    const pos = getWindReferencePosition();
    if(!pos) throw new Error("Sin coordenada de referencia para viento.");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(pos.lat.toFixed(5))}&longitude=${encodeURIComponent(pos.lng.toFixed(5))}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh&timezone=auto&forecast_days=2`;
    const res = await fetch(url, {cache:"no-store"});
    if(!res.ok) throw new Error("No se pudo consultar el pronóstico.");
    const data = await res.json();
    const idx = nearestHourlyIndex(data?.hourly?.time || [], Date.now());
    const speed = Number(data?.hourly?.wind_speed_10m?.[idx]);
    const gust = Number(data?.hourly?.wind_gusts_10m?.[idx]);
    const deg = Number(data?.hourly?.wind_direction_10m?.[idx]);
    if(!isFinite(speed)) throw new Error("Pronóstico de viento sin velocidad válida.");
    const level = windLevel(speed, gust);
    return {
      at: new Date().toISOString(),
      timeLabel: new Date().toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}),
      kmh: speed,
      gustKmh: isFinite(gust) ? gust : null,
      directionDeg: isFinite(deg) ? deg : null,
      direction: windDirectionLabel(deg),
      level: level.label,
      source: WIND.provider,
      forecast: true,
      lat: pos.lat,
      lng: pos.lng,
      note: "Dato procedente de pronóstico meteorológico, no de medición directa en parcela."
    };
  }

  function addWindReading(reading){
    if(!state.work || !reading) return;
    state.work.windReadings = state.work.windReadings || [];
    state.work.windReadings.push(reading);
    updateWindUi();
    storage.set(LS.active, state.work);
  }

  function handleWindWarning(reading){
    if(!reading || !["Precaución","Exceso"].includes(reading.level)) return;
    const msg = `Advertencia de viento\n\nViento previsto: ${formatWind(reading.kmh)}${reading.gustKmh ? ` · racha ${formatWind(reading.gustKmh)}` : ""} · ${reading.direction || "—"}.\n\nDato basado en pronóstico meteorológico, no en medición directa en parcela.`;
    addEvent("Aviso viento", reading.level, `${formatWind(reading.kmh)} · racha ${formatWind(reading.gustKmh)} · ${reading.direction || "—"}. Pronóstico, no medición directa.`);
    if(reading.level === "Exceso"){
      const ok = confirm(msg + "\n\nEl valor supera el umbral de precaución/exceso configurado para fitosanitarios. ¿Continuar bajo responsabilidad?");
      reading.confirmedByOperator = ok;
      if(!ok && state.work?.status === "trabajando"){
        const now = Date.now();
        const ms = now - (state.work.lastSegmentAt || now);
        state.work.activeMs += ms;
        addActiveToCurrentSession(ms);
        state.work.status = "parado";
        state.work.pausedAt = now;
        state.work.stops += 1;
        addEvent("Parada", "Advertencia de viento", "El operario canceló continuar bajo responsabilidad.");
        $("stopWorkBtn").classList.add("hidden");
        $("continueWorkBtn").classList.remove("hidden");
        setWorkStateUi("Parado");
      }
    } else {
      alert(msg);
    }
  }

    async function captureWindForecast(auto=false, title="Viento previsto"){
    if(!state.work || state.work.status !== "trabajando" || !workUsesWind(state.work)) return;
    if(state.windPromptOpen) return;
    state.windPromptOpen = true;
    try{
      const reading = await fetchForecastWind();
      reading.autoPrompt = !!auto;
      addWindReading(reading);
      handleWindWarning(reading);
    }catch(err){
      const ok = confirm(`${title}: no se pudo consultar el pronóstico de viento. ¿Registrar un valor manual como referencia?`);
      if(ok) promptWindManual(auto, title);
    }finally{
      if(state.work) state.work.nextWindPromptAt = Date.now() + WIND.intervalMs;
      state.windPromptOpen = false;
      storage.set(LS.active, state.work);
    }
  }

    function promptWindManual(auto=false, title="Registrar viento"){
    if(!state.work || !workUsesWind(state.work)) return;
    const raw = prompt(`${title}. Velocidad del viento en km/h:`, "");
    if(raw === null || String(raw).trim() === "") return;
    const value = Number(String(raw).replace(",", "."));
    if(!isFinite(value) || value < 0 || value > 150){
      toast("Valor de viento no válido. Introduce km/h entre 0 y 150.");
      return;
    }
    const dir = prompt("Dirección del viento (N, NE, E, SE, S, SO, O, NO...):", "");
    const level = windLevel(value, null);
    addWindReading({
      at: new Date().toISOString(),
      timeLabel: new Date().toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}),
      kmh: value, gustKmh: null, direction: normalizeListValue(dir || ""),
      level: level.label, source:"Manual", forecast:false, autoPrompt:!!auto,
      note:"Dato introducido manualmente; no es medición automática de la app."
    });
  }

    function checkWindPrompt(){
    if(!state.work || state.work.status !== "trabajando" || !workUsesWind(state.work)) return;
    if(!state.work.nextWindPromptAt) state.work.nextWindPromptAt = Date.now() + WIND.intervalMs;
    if(Date.now() >= state.work.nextWindPromptAt) captureWindForecast(true, "Registro periódico de viento previsto");
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
      {
        const ms = now - (state.work.lastSegmentAt || now);
        state.work.activeMs += ms;
        addActiveToCurrentSession(ms);
        finishCurrentSession(now);
      }
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
    {
      const ms = now - (state.work.lastSegmentAt || now);
      state.work.activeMs += ms;
      addActiveToCurrentSession(ms);
    }

    $("stopWorkBtn").classList.add("hidden");
    $("continueWorkBtn").classList.remove("hidden");
    setWorkStateUi("Parado");
    $("refillCount").textContent = String(state.work.refills);
    storage.set(LS.active, state.work);
  }

  function continueWork(){
    if(!state.work || state.work.status !== "parado") return;
    const now = Date.now();
    if(state.work.pausedAt){
      const stopped = now - state.work.pausedAt;
      state.work.stoppedMs += stopped;
      addStoppedToCurrentSession(stopped);
    }
    if(!currentSession()){
      startNewSession("continuacion");
      addEvent("Continuar", "Nueva sesión", "Se retoma un trabajo pendiente.");
    } else {
      addEvent("Continuar", "Reanudación", "Continúa el trabajo");
    }
    state.work.status = "trabajando";
    state.work.lastSegmentAt = now;
    state.work.nextWindPromptAt = now + WIND.intervalMs;
    $("stopWorkBtn").classList.remove("hidden");
    $("continueWorkBtn").classList.add("hidden");
    setWorkStateUi("Trabajando");
    state.trackingFollow = true;
    startGpsWatch();
    centerWorkMapOnTractor(true);
    if(workUsesWind(state.work)) setTimeout(() => captureWindForecast(false, "Viento previsto al retomar"), 900);
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
    ensureSessions(w);
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
    const sessions = ensureSessions(w);
    if(sessions.length){
      return sessions.reduce((sum, s) => {
        const start = Number(s.startedAt);
        const end = Number(s.finishedAt || (w.status === "trabajando" && s.id === w.currentSessionId ? Date.now() : s.startedAt));
        return sum + (isFinite(start) && isFinite(end) && end > start ? end - start : 0);
      }, 0);
    }
    return w?.startedAt ? (w.finishedAt || Date.now()) - w.startedAt : 0;
  }

  function reportEffectiveActiveMs(w){
    const sessions = ensureSessions(w);
    if(sessions.length){
      let ms = sessions.reduce((sum, s) => sum + (Number(s.activeMs) || 0), 0);
      if(w?.status === "trabajando" && w.lastSegmentAt) ms += Date.now() - w.lastSegmentAt;
      return ms;
    }
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
    syncWindVisibility(w);
    const ws = windStats(w.windReadings || []);
    $("reportWind").textContent = workUsesWind(w) && ws.latest !== null ? formatWind(ws.latest) : "—";

    const activeTab = document.querySelector(".report-tabs .tab.active")?.dataset.reportTab || "summary";
    if(activeTab === "work") renderReportWork(w);
    else if(activeTab === "events") renderReportEvents(w);
    else if(activeTab === "gps") renderReportGps(w);
    else if(activeTab === "wind") renderReportWind(w);
    else if(activeTab === "incidents") renderReportIncidents(w);
    else if(activeTab === "export") renderReportExport(w);
    else renderReportSummary(w);

    const reportFeature = w.parcelFeature || findParcelFeatureByName(w.parcel) || (w.parcel === state.selectedParcelName ? state.selectedFeature : null);
    const hasMapData = Boolean(reportFeature) || (w.pointsClean || []).length > 0 || (w.events || []).some(e=>e.lat && e.lng) || (w.incidents || []).some(i=>i.lat && i.lng);
    if(hasMapData) renderReportMap(w); else $("reportMap").classList.add("hidden");
  }


  function windMarkerHtml(reading){
    const cls = levelClass(reading.level);
    const deg = isFinite(Number(reading.directionDeg)) ? Number(reading.directionDeg) : 0;
    return {
      cls,
      html: `<div class="wind-arrow-wrap ${cls === "warn" ? "warn" : cls === "bad" ? "bad" : ""}"><div class="wind-arrow-shaft" style="transform:rotate(${deg}deg)">➜</div><div class="wind-arrow-chip">${escapeHtml(formatWind(reading.kmh))}</div></div>`
    };
  }

  function drawReportWindOverlay(map, w){
    if(!workUsesWind(w)) return;
    const readings = (w.windReadings || []).filter(r => isFinite(r.lat) && isFinite(r.lng));
    readings.forEach(r => {
      const markerData = windMarkerHtml(r);
      const icon = L.divIcon({ className:`wind-marker ${markerData.cls}`, html: markerData.html, iconSize:[48,48], iconAnchor:[24,24] });
      L.marker([r.lat, r.lng], { icon }).addTo(map).bindTooltip(`${escapeHtml(r.timeLabel || "—")} · ${escapeHtml(formatWind(r.kmh))} · ${escapeHtml(r.direction || "—")} · ${escapeHtml(r.level || "—")}`, {direction:"top"});
    });
  }

  function nearestWindLevelForTime(w, time){
    if(!workUsesWind(w)) return null;
    const readings = (w.windReadings || []).filter(r => r && r.at && r.level);
    if(!readings.length || !time) return null;
    let best = null, bestDelta = Infinity;
    readings.forEach(r => {
      const t = new Date(r.at).getTime();
      const d = Math.abs(Number(time) - t);
      if(isFinite(d) && d < bestDelta){ bestDelta = d; best = r; }
    });
    return best?.level || null;
  }

  function drawQualityRoute(map, w, pts){
    if(!pts.length) return null;
    if(pts.length === 1){
      return L.circleMarker(pts[0], {radius:7,color:"#fff",weight:2,fillColor:"#1d7fd1",fillOpacity:1}).addTo(map);
    }
    const routeBack = L.polyline(pts.map(p=>[p.lat,p.lng]), {color:"#fff7df",weight:10,opacity:.95}).addTo(map).bringToFront();
    let bounds = routeBack.getBounds();
    for(let i=1; i<pts.length; i++){
      const level = nearestWindLevelForTime(w, pts[i].time);
      const color = level ? levelColor(level) : (pts[i].quality === "dudoso" ? "#d8a52d" : pts[i].quality === "descartado" ? "#c24a3f" : "#1d7fd1");
      L.polyline([[pts[i-1].lat, pts[i-1].lng], [pts[i].lat, pts[i].lng]], {color,weight:6,opacity:.98}).addTo(map).bringToFront();
    }
    L.circleMarker([pts[0].lat,pts[0].lng], {radius:7,color:"#fff",weight:2,fillColor:"#2f7d44",fillOpacity:1}).addTo(map).bindTooltip("Inicio");
    L.circleMarker([pts[pts.length-1].lat,pts[pts.length-1].lng], {radius:7,color:"#fff",weight:2,fillColor:"#a8483a",fillOpacity:1}).addTo(map).bindTooltip("Fin / último punto");
    return { getBounds: () => bounds };
  }


    function renderReportMap(w){
    const el = $("reportMap");
    el.classList.remove("hidden");
    el.querySelectorAll(".map-note").forEach(n => n.remove());
    waitForMapContainer("reportMap", () => {
      const map = makeMap("reportMap", "report", { zoomControl:false, attributionControl:true, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, tap:false });
      if(!map){ el.classList.add("hidden"); return; }
      const reportFeature = w.parcelFeature || findParcelFeatureByName(w.parcel) || (w.parcel === state.selectedParcelName ? state.selectedFeature : null);
      let bounds = null;
      if(reportFeature) {
        const lyr = L.geoJSON(reportFeature, { style: parcelStyle(true) }).addTo(map).bringToFront();
        if(lyr.getBounds && lyr.getBounds().isValid()) bounds = lyr.getBounds();
      }
      drawImportedIncidents(map, "reportImportedIncidents");
      const cleanPts = (w.pointsClean || []).filter(p => isFinite(p.lat) && isFinite(p.lng));
      if(cleanPts.length > 0) {
        const routeLayer = drawQualityRoute(map, w, cleanPts);
        if(routeLayer && routeLayer.getBounds){
          bounds = bounds && bounds.isValid() ? bounds.extend(routeLayer.getBounds()) : routeLayer.getBounds();
        }
      } else {
        const note = document.createElement("div");
        note.className = "map-note";
        note.textContent = "No hay recorrido GPS registrado para este trabajo.";
        el.appendChild(note);
      }
      drawReportWindOverlay(map, w);
      (w.events || []).forEach(ev => {
        if(ev.lat && ev.lng) L.circleMarker([ev.lat,ev.lng], {radius:7,color:"#fff",weight:2,fillColor:ev.type.includes("Fin")?"#a8483a":ev.type==="Comienzo"?"#2f7d44":"#c47b32",fillOpacity:1}).addTo(map).bringToFront();
      });
      (w.incidents || []).forEach(inc => {
        if(inc.lat && inc.lng) L.circleMarker([inc.lat,inc.lng], {radius:7,color:"#fff",weight:2,fillColor:getIncidentColor(inc.type),fillOpacity:1}).addTo(map).bringToFront();
      });
      if(bounds && bounds.isValid()) stabilizeMap(map, bounds, [24,24]);
      else stabilizeMap(map, null, [24,24]);
    });
  }

  function reportWarning(w){
    const gps = w.gpsStats || {};
    if(w.forcedStart || gps.discarded > 0 || (gps.worst && gps.worst > 15)){
      return `<div class="report-warning"><strong>Advertencia GPS:</strong> el trazado debe interpretarse como aproximado en algunos tramos. Se conservaron los puntos originales y se generó una ruta depurada para visualización e informe.</div>`;
    }
    return "";
  }


  function fmtDateShort(ms){
    const d = new Date(Number(ms));
    return d && !isNaN(d.getTime()) ? d.toLocaleDateString("es-ES") : "—";
  }

  function eventKindClass(type){
    if(String(type||"").toLowerCase().includes("incid")) return "bad";
    if(String(type||"").toLowerCase().includes("parada")) return "warn";
    return "ok";
  }

  function pointIntervals(w, minutes=30){
    const points = (w.pointsOriginal || w.pointsClean || []).filter(p => p && p.time && isFinite(p.accuracy));
    if(!points.length) return [];
    const buckets = new Map();
    points.forEach(p => {
      const d = new Date(Number(p.time));
      d.setSeconds(0,0);
      const mins = d.getMinutes();
      d.setMinutes(Math.floor(mins/minutes)*minutes);
      const key = d.getTime();
      if(!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    });
    return Array.from(buckets.entries()).sort((a,b)=>a[0]-b[0]).map(([start, arr]) => {
      const end = start + minutes*60000;
      const avg = arr.reduce((sum,p)=>sum+Number(p.accuracy||0),0)/arr.length;
      return { start, end, avg, count: arr.length, label:gpsClass(avg).label };
    });
  }

  function windDurations(readings){
    const counts = {Recomendado:0, Precaución:0, Exceso:0};
    (readings || []).forEach(r => {
      if(r.level === "Exceso") counts.Exceso += WIND.intervalMs;
      else if(r.level === "Precaución") counts.Precaución += WIND.intervalMs;
      else if(r.level) counts.Recomendado += WIND.intervalMs;
    });
    return counts;
  }

  function reportConclusion(text){
    return `<div class="report-conclusion"><div class="report-section-title">Conclusión</div><p>${escapeHtml(text)}</p></div>`;
  }


    function renderReportSummary(w){
    const day = w.day || {};
    const status = w.status === "finalizado" ? "Finalizado" : "Provisional";
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        ${reportWarning(w)}
        <div class="report-section-title">Resumen general</div>
        <div class="report-grid">
          ${reportKpi("Tiempo total", fmtTime(reportTotalMs(w)))}
          ${reportKpi("Distancia", ((w.distanceM || 0)/1000).toFixed(2).replace(".", ",") + " km")}
          ${reportKpi("Recargas", String(w.refills || 0))}
          ${reportKpi("Incidencias", String((w.incidents || []).length))}
        </div>
        <div class="report-summary-strip">
          <span>${escapeHtml(status)}</span><span>·</span><span>${escapeHtml(w.startedAt ? fmtDateShort(w.startedAt) : "—")}</span><span>·</span><span>Operario: ${escapeHtml(day.operator || "—")}</span><span>·</span><span>Tractor: ${escapeHtml(day.tractor || "—")}</span>
        </div>
        <div class="report-section-title">Datos del trabajo</div>
        <div class="report-grid">
          ${reportKpi("Parcela", w.parcel || "—")}
          ${reportKpi("Labor", w.type || "—")}
          ${reportKpi("Estado", status)}
          ${reportKpi("Inicio", w.startedAt ? new Date(w.startedAt).toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}) : "—")}
          ${reportKpi("Fin", w.finishedAt ? new Date(w.finishedAt).toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}) : "—")}
          ${reportKpi("Tiempo activo", fmtTime(reportEffectiveActiveMs(w)))}
        </div>
        ${reportConclusion(`El trabajo ${w.status === "finalizado" ? "se completó" : "queda provisional"} con ${w.refills || 0} recarga(s) y ${(w.incidents || []).length} incidencia(s) registrada(s).`)}
      </div>
    `;
  }

  function sessionDateLabel(ms){
    const d = new Date(Number(ms));
    return d && !isNaN(d.getTime()) ? d.toLocaleDateString("es-ES") : "—";
  }
  function sessionTimeLabel(ms){
    const d = new Date(Number(ms));
    return d && !isNaN(d.getTime()) ? d.toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}) : "—";
  }

    function renderReportWork(w){
    const sessions = ensureSessions(w);
    const stopped = w.stoppedMs || sessions.reduce((sum,s)=>sum+(Number(s.stoppedMs)||0),0);
    const sessionCards = sessions.length ? sessions.map((s, idx) => {
      const cls = idx === 1 ? "warn" : idx >= 2 ? "bad" : "";
      return `<div class="session-card ${cls}"><span class="session-badge">${idx+1}</span><div><strong>${escapeHtml(sessionDateLabel(s.startedAt))} · ${escapeHtml(sessionTimeLabel(s.startedAt))} → ${escapeHtml(s.finishedAt ? sessionTimeLabel(s.finishedAt) : "pendiente")}</strong><small>Activo ${escapeHtml(fmtTime(s.activeMs || 0))} · Parado ${escapeHtml(fmtTime(s.stoppedMs || 0))}${s.notes ? " · " + escapeHtml(s.notes) : ""}</small></div></div>`;
    }).join("") : reportEmpty("Sin sesiones separadas registradas.");
    const tableRows = sessions.length ? sessions.map((s, idx) => `
      <div class="report-table-row"><span>${escapeHtml(sessionDateLabel(s.startedAt))}</span><span>${escapeHtml(sessionTimeLabel(s.startedAt))}</span><span>${escapeHtml(s.finishedAt ? sessionTimeLabel(s.finishedAt) : "pendiente")}</span><span><strong>${escapeHtml(fmtTime(s.activeMs || 0))}</strong></span></div>`).join("") : "";
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        <div class="report-section-title">Resumen de trabajo</div>
        <div class="report-grid">
          ${reportKpi("Tiempo activo", fmtTime(reportEffectiveActiveMs(w)))}
          ${reportKpi("Tiempo parado", fmtTime(stopped))}
          ${reportKpi("Sesiones", String(sessions.length || (w.startedAt ? 1 : 0)))}
          ${reportKpi("Recargas", String(w.refills || 0))}
        </div>
        <div class="timeline-panel">
          <div class="report-section-title">Sesiones de trabajo</div>
          ${sessionCards}
        </div>
        <div class="report-section-title">Detalle por sesiones</div>
        <div class="report-table">
          <div class="report-table-row"><span>Fecha</span><span>Inicio</span><span>Fin</span><span>Activo</span></div>
          ${tableRows}
        </div>
        ${reportConclusion(sessions.length > 1 ? `La parcela se completó o continuó en ${sessions.length} jornadas de trabajo. El tiempo efectivo acumulado fue de ${fmtTime(reportEffectiveActiveMs(w))}.` : `El trabajo registra ${fmtTime(reportEffectiveActiveMs(w))} de tiempo efectivo.`)}
      </div>`;
  }

    function renderReportEvents(w){
    const events = w.events || [];
    const timeline = events.map(ev => {
      const cls = eventKindClass(ev.type);
      const icon = cls === "bad" ? "!" : cls === "warn" ? "Ⅱ" : (ev.type === "Comienzo" ? "▶" : ev.type.includes("Fin") ? "■" : "●");
      return `<div class="timeline-item ${cls === "warn" ? "warn" : cls === "bad" ? "bad" : ""}"><span class="time">${escapeHtml(ev.timeLabel || "—")}</span><span class="timeline-icon">${icon}</span><div><strong>${escapeHtml(ev.type)}</strong><small>${escapeHtml(ev.label || ev.notes || "—")}</small></div></div>`;
    }).join("");
    const tableRows = events.map(ev => `<div class="report-table-row"><span>${escapeHtml(ev.timeLabel || "—")}</span><span><strong>${escapeHtml(ev.type)}</strong></span><span>${escapeHtml(ev.label || "—")}</span><span>${escapeHtml(ev.notes || "—")}</span></div>`).join("");
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        <div class="report-section-title">Resumen de eventos</div>
        <div class="report-grid">
          ${reportKpi("Eventos", String(events.length))}
          ${reportKpi("Paradas", String((w.events || []).filter(e=>e.type==="Parada").length))}
          ${reportKpi("Recargas", String(w.refills || 0))}
          ${reportKpi("Incidencias", String((w.incidents || []).length))}
        </div>
        <div class="report-summary-strip"><span>Inicio ${escapeHtml(w.startedAt ? new Date(w.startedAt).toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"}) : "—")}</span><span>·</span><span>Último evento ${escapeHtml(events.at(-1)?.timeLabel || "—")}</span><span>·</span><span>Estado ${escapeHtml(w.status === "finalizado" ? "Finalizado" : "Provisional")}</span></div>
        <div class="report-section-title">Cronología del trabajo</div>
        <div class="timeline-panel">${timeline || reportEmpty("Sin eventos registrados todavía.")}</div>
        <div class="report-section-title">Detalle de eventos</div>
        <div class="report-table">
          <div class="report-table-row"><span>Hora</span><span>Evento</span><span>Etiqueta</span><span>Observación</span></div>
          ${tableRows}
        </div>
        ${reportConclusion(`La actividad registra ${events.length} evento(s), ${(w.events || []).filter(e=>e.type==="Parada").length} parada(s) y ${w.refills || 0} recarga(s).`)}
      </div>`;
  }

    function renderReportIncidents(w){
    const incidents = w.incidents || [];
    const pending = incidents.filter(i => String(i.status||"").toLowerCase().includes("pend")).length;
    const resolved = incidents.length - pending;
    const photos = incidents.filter(i => i.photo).length;
    const typeCounts = {};
    incidents.forEach(i => typeCounts[i.type || "Otra"] = (typeCounts[i.type || "Otra"] || 0) + 1);
    const typeStrip = Object.entries(typeCounts).map(([type,count]) => `<span><span class="report-dot" style="background:${escapeHtml(getIncidentColor(type))}"></span>${escapeHtml(type)} ${count}</span>`).join("<span>·</span>");
    const rows = incidents.map(i => `<div class="report-table-row"><span>${escapeHtml(i.timeLabel || "—")}</span><span><span class="report-dot" style="background:${escapeHtml(getIncidentColor(i.type))}"></span> ${escapeHtml(i.type)}</span><span>${statePill(i.status || "Pendiente")}</span><span>${i.photo ? "Foto" : "—"}</span></div>`).join("");
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        <div class="report-section-title">Resumen de incidencias</div>
        <div class="report-grid">
          ${reportKpi("Total", String(incidents.length))}
          ${reportKpi("Pendientes", String(pending))}
          ${reportKpi("Resueltas", String(resolved))}
          ${reportKpi("Fotos", String(photos))}
        </div>
        <div class="report-summary-strip">${typeStrip || "<span>Sin incidencias</span>"}</div>
        <div class="report-section-title">Detalle de incidencias</div>
        <div class="report-table">
          <div class="report-table-row"><span>Hora</span><span>Tipo</span><span>Estado</span><span>Foto</span></div>
          ${rows}
        </div>
        ${reportConclusion(incidents.length ? `Se registraron ${incidents.length} incidencia(s) durante el trabajo. ${pending} queda(n) pendiente(s) de revisión.` : "No se registraron incidencias durante el trabajo.")}
      </div>`;
  }

    function renderReportGps(w){
    const cal = w.gpsCalibration || {};
    const gps = w.gpsStats || {};
    const avgAcc = gps.count ? (gps.sum / gps.count) : null;
    const intervals = pointIntervals(w, 30);
    const goodMs = intervals.filter(i => i.label === "Buena").length * 30 * 60000;
    const acceptMs = intervals.filter(i => i.label === "Aceptable").length * 30 * 60000;
    const badMs = intervals.filter(i => !["Buena","Aceptable"].includes(i.label)).length * 30 * 60000;
    const rows = intervals.map(i => `<div class="report-table-row"><span>${escapeHtml(sessionTimeLabel(i.start))}–${escapeHtml(sessionTimeLabel(i.end))}</span><span><strong>${escapeHtml(formatMeters(i.avg))}</strong></span><span>${statePill(i.label)}</span><span>${escapeHtml(String(i.count))}</span></div>`).join("");
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        ${reportWarning(w)}
        <div class="report-section-title">Resumen GPS</div>
        <div class="report-grid">
          ${reportKpi("Precisión media", formatMeters(avgAcc))}
          ${reportKpi("Mejor", formatMeters(gps.best))}
          ${reportKpi("Peor", formatMeters(gps.worst))}
          ${reportKpi("Puntos válidos", String((w.pointsClean || []).length))}
        </div>
        <div class="report-summary-strip"><span><span class="report-dot"></span>Buena ${escapeHtml(fmtTime(goodMs))}</span><span>·</span><span><span class="report-dot warn"></span>Aceptable ${escapeHtml(fmtTime(acceptMs))}</span><span>·</span><span><span class="report-dot bad"></span>Insuficiente ${escapeHtml(fmtTime(badMs))}</span></div>
        <div class="report-section-title">Detalle por intervalos</div>
        <div class="report-table">
          <div class="report-table-row"><span>Intervalo</span><span>Precisión</span><span>Estado</span><span>Puntos</span></div>
          ${rows || reportEmpty("Sin puntos GPS suficientes para detallar intervalos.")}
        </div>
        ${reportConclusion("La calidad GPS debe interpretarse según la precisión registrada. Los tramos con peor precisión se conservan como referencia visual y técnica.")}
      </div>`;
  }

    function renderReportWind(w){
    if(!workUsesWind(w)){
      $("reportContent").innerHTML = `<div class="scroll-box report-visual">${reportEmpty("El parámetro viento solo se registra y visualiza en trabajos de aplicación de fitosanitarios.")}</div>`;
      return;
    }
    const readings = (w.windReadings || []).filter(r => r && r.at);
    const ws = windStats(readings);
    const durations = windDurations(readings);
    const rows = readings.map(r => `
      <div class="report-table-row">
        <span>${escapeHtml(r.timeLabel || "—")}</span>
        <span><strong>${escapeHtml(formatWind(r.kmh))}</strong></span>
        <span>${escapeHtml(r.direction || "—")}</span>
        <span>${statePill(r.level || "—")}</span>
      </div>`).join("");
    const warning = ws.warnings ? `<div class="report-warning"><strong>Advertencia meteorológica:</strong> durante el trabajo hubo ${ws.warnings} registro(s) por encima del rango recomendado. Los datos proceden de pronóstico meteorológico y no sustituyen una medición directa en parcela.</div>` : "";
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        ${warning}
        <div class="report-section-title">Resumen de viento</div>
        <div class="report-grid">
          ${reportKpi("Viento medio", ws.avg === null ? "—" : formatWind(ws.avg))}
          ${reportKpi("Viento máximo", ws.max === null ? "—" : formatWind(ws.max))}
          ${reportKpi("Dirección predominante", ws.dominant || "—")}
          ${reportKpi("Estado global", ws.max === null ? "—" : windLevel(ws.avg || 0, ws.max || 0).label)}
        </div>
        <div class="report-summary-strip">
          <span><span class="report-dot"></span>Verde ${escapeHtml(fmtTime(durations.Recomendado))}</span>
          <span>·</span>
          <span><span class="report-dot warn"></span>Ámbar ${escapeHtml(fmtTime(durations.Precaución))}</span>
          <span>·</span>
          <span><span class="report-dot bad"></span>Rojo ${escapeHtml(fmtTime(durations.Exceso))}</span>
        </div>
        <div class="report-note"><strong>Umbrales:</strong> Verde/recomendado 0–10,8 km/h · Ámbar/precaución 10,9–15,3 km/h · Rojo/exceso &gt;15,3 km/h.</div>
        <div class="report-section-title">Detalle por intervalos</div>
        <div class="report-table">
          <div class="report-table-row"><span>Intervalo</span><span>Viento</span><span>Dirección</span><span>Estado</span></div>
          ${rows || reportEmpty("Sin registros de viento previsto. Solo se computan datos dentro del tiempo activo de trabajo.")}
        </div>
        ${reportConclusion(ws.max && ws.max > WIND.cautionKmh ? "Se registraron intervalos con viento excesivo por encima de 15,3 km/h. El dato procede de pronóstico meteorológico y no de medición directa en parcela." : "El tratamiento se mantuvo dentro de los rangos de viento recomendados o de precaución registrados.")}
        <div class="report-note"><strong>Nota:</strong> dato procedente de pronóstico meteorológico, no de medición directa en parcela.</div>
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
    const header = "hora,velocidad_kmh,racha_kmh,direccion,estado,fuente,tipo_dato,observacion\n";
    const rows = (w.windReadings || []).map(r => [r.timeLabel, r.kmh, r.gustKmh, r.direction, r.level, r.source, r.forecast ? "pronostico" : "manual", r.note].map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
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
    suspendWorkAsPending();
    const hist = storage.get(LS.history, []);
    const snap = serializeWork({...state.work, status:"pendiente"});
    const idx = hist.findIndex(w => w.id === snap.id);
    if(idx >= 0) hist[idx] = snap;
    else hist.unshift(snap);
    storage.set(LS.history, hist.slice(0, 200));
    storage.set(LS.active, snap);
  }

  function resumePendingWork(index){
    const hist = storage.get(LS.history, []);
    const w = hist[Number(index)];
    if(!w || workIsCompleted(w)) return;
    state.work = serializeWork({...w, status:"parado", currentSessionId:null, pausedAt:null, lastSegmentAt:null});
    state.selectedParcelName = state.work.parcel || "";
    state.workType = state.work.type || "";
    state.selectedFeature = state.work.parcelFeature || findParcelFeatureByName(state.work.parcel) || state.selectedFeature;
    state.reportWork = null;
    state.reportOrigin = "work";
    storage.set(LS.active, state.work);
    show("screen-work");
    syncWindVisibility(state.work);
    afterLayoutStable(() => { setupWorkMap(); resumeWorkUi(); });
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
      <div class="history-card history-card-v11" data-history-index="${originalIndex}">
        <button class="history-open" type="button" data-history-open="${originalIndex}">
          <span class="history-date">${escapeHtml(workHistoryDate(w))}</span>
          <strong>${escapeHtml(w.parcel || "Parcela sin nombre")}</strong>
          <span class="history-type">${escapeHtml(w.type || "Trabajo sin tipo")}</span>
        </button>
        <span class="history-status ${cls}">${status}</span>
        ${status === "Pendiente" ? `<button class="history-continue" type="button" data-history-continue="${originalIndex}">Continuar</button>` : ""}
      </div>`;
    }).join("") : `<div class="history-empty">${filter === "pending" ? "No hay trabajos pendientes." : filter === "completed" ? "No hay trabajos completados." : "No hay trabajos guardados."}</div>`;

    qsa("[data-history-open]").forEach(card => {
      card.addEventListener("click", () => {
        const latest = storage.get(LS.history, []);
        const w = latest[Number(card.dataset.historyOpen)];
        if(w) openReportForWork(w, "history");
      });
    });
    qsa("[data-history-continue]").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        resumePendingWork(btn.dataset.historyContinue);
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
    $("windReadingBtn").onclick = () => { if(workUsesWind(state.work)) captureWindForecast(false, "Consulta de viento previsto"); };

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