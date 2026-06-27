(() => {
  "use strict";

  const VERSION = "Beta 0.8 Profesional Privada · Mapa reprogramado";
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
    tickerStarted: false
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
    $("parcelListPreview").innerHTML = names.map(n => `<div>• ${escapeHtml(n)}</div>`).join("");
    $("parcelListPreview").classList.remove("hidden");
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

  function addToList(key){
    const label = {operators:"operario", tractors:"tractor", sprayers:"atomizador/cisterna"}[key] || "elemento";
    const value = prompt(`Nuevo ${label}:`);
    if(!value) return;
    const lists = storage.get(LS.lists, {});
    lists[key] = Array.from(new Set([...(lists[key]||[]), value.trim()].filter(Boolean)));
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
        $("dayStatus").innerHTML = `<strong>Jornada anterior detectada.</strong><br>La configuración guardada es del ${escapeHtml(day.date)}. Revísala y pulsa Guardar jornada para usarla hoy.`;
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

  function resetLiveUi(){
    $("beginWorkBtn").classList.remove("hidden");
    $("stopWorkBtn").classList.add("hidden");
    $("continueWorkBtn").classList.add("hidden");
    $("workStateLabel").textContent = "Preparado";
    $("liveSpeed").textContent = "0,0";
    $("partialTime").textContent = "00:00";
    $("totalTime").textContent = "00:00";
    $("distanceKm").textContent = "0,00";
    $("liveAccuracy").textContent = "—";
    $("refillCount").textContent = "0";
  }

  function beginWork(){
    if(!state.work) return;
    state.work.status = "trabajando";
    state.work.startedAt = Date.now();
    state.work.lastSegmentAt = Date.now();
    addEvent("Comienzo", "Punto inicial", "Inicio del trabajo");
    $("beginWorkBtn").classList.add("hidden");
    $("stopWorkBtn").classList.remove("hidden");
    $("continueWorkBtn").classList.add("hidden");
    $("workStateLabel").textContent = "Trabajando";
    startGpsWatch();
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
      if(state.trackingFollow && state.currentPos) map.setView([state.currentPos.lat, state.currentPos.lng], Math.max(map.getZoom(), 18));
    }
    drawCurrentPosition(state.currentPos);
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
      $("workStateLabel").textContent = "Finalizado";
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
    $("workStateLabel").textContent = "Parado";
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
    $("workStateLabel").textContent = "Trabajando";
    storage.set(LS.active, state.work);
  }

  function updateLiveStats(){
    if(!state.work) return;
    $("distanceKm").textContent = (state.work.distanceM/1000).toFixed(2).replace(".", ",");
    $("refillCount").textContent = String(state.work.refills);
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
    }
    requestAnimationFrame(() => setTimeout(tick, 1000));
  }

  function saveFinishedWork(){
    const hist = storage.get(LS.history, []);
    hist.unshift(serializeWork(state.work));
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

  function renderReport(){
    const w = getReportWork();
    if(!w){
      $("reportContent").innerHTML = "No hay trabajo para informar.";
      return;
    }

    $("reportSubtitle").textContent = `${w.parcel} · ${w.type}`;
    $("reportStatusChip").textContent = w.status === "finalizado" ? "Informe definitivo" : "Resumen provisional";
    $("reportStatusChip").style.background = w.status === "finalizado" ? "#eaf6e9" : "#fff4e6";
    $("reportStatusChip").style.color = w.status === "finalizado" ? "#2f7d44" : "#8b520e";
    const totalMs = w.startedAt ? (w.finishedAt || Date.now()) - w.startedAt : 0;
    $("reportTotal").textContent = fmtTime(totalMs);
    $("reportDistance").textContent = ((w.distanceM || 0)/1000).toFixed(2).replace(".", ",") + " km";
    $("reportRefills").textContent = String(w.refills || 0);

    renderReportSummary(w);
    renderReportMap(w);
  }

  function renderReportMap(w){
    const el = $("reportMap");
    if(state.maps.report){
      state.maps.report.remove();
      state.maps.report = null;
    }
    el.innerHTML = "";
    if(!ensureLeaflet()) return;
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

  function renderReportSummary(w){
    const day = w.day || {};
    const cal = w.gpsCalibration || {};
    const gps = w.gpsStats || {};
    const avgAcc = gps.count ? (gps.sum / gps.count) : null;
    const totalMs = w.startedAt ? (w.finishedAt || Date.now()) - w.startedAt : 0;
    $("reportContent").innerHTML = `
      <div class="scroll-box report-sheet">
        <h3>PAZO BAION GPS</h3>
        <p class="report-sub">Informe de trabajo en parcela</p>
        ${reportWarning(w)}
        <table>
          <tr><th colspan="2">Datos generales</th></tr>
          <tr><td>Parcela</td><td>${escapeHtml(w.parcel)}</td></tr>
          <tr><td>Tipo de trabajo</td><td>${escapeHtml(w.type)}</td></tr>
          <tr><td>Estado</td><td>${w.status === "finalizado" ? "Finalizado" : "Provisional / no finalizado"}</td></tr>
          <tr><td>Inicio</td><td>${w.startedAt ? new Date(w.startedAt).toLocaleString("es-ES") : "—"}</td></tr>
          <tr><td>Fin</td><td>${w.finishedAt ? new Date(w.finishedAt).toLocaleString("es-ES") : "—"}</td></tr>
          <tr><td>Duración total</td><td>${fmtTime(totalMs)}</td></tr>
          <tr><th colspan="2">Jornada</th></tr>
          <tr><td>Operario</td><td>${escapeHtml(day.operator || "—")}</td></tr>
          <tr><td>Tractor</td><td>${escapeHtml(day.tractor || "—")}</td></tr>
          <tr><td>Atomizador / cisterna</td><td>${escapeHtml(day.sprayer || "—")}</td></tr>
          <tr><td>Observaciones jornada</td><td>${escapeHtml(day.notes || "—")}</td></tr>
          <tr><th colspan="2">Resumen operativo</th></tr>
          <tr><td>Distancia recorrida</td><td>${((w.distanceM || 0)/1000).toFixed(2).replace(".", ",")} km</td></tr>
          <tr><td>Tiempo efectivo</td><td>${fmtTime(w.activeMs || 0)}</td></tr>
          <tr><td>Tiempo parado</td><td>${fmtTime(w.stoppedMs || 0)}</td></tr>
          <tr><td>Paradas</td><td>${w.stops || 0}</td></tr>
          <tr><td>Recargas</td><td>${w.refills || 0}</td></tr>
          <tr><td>Incidencias registradas</td><td>${(w.incidents || []).length}</td></tr>
          <tr><th colspan="2">Calidad GPS</th></tr>
          <tr><td>Calibración previa</td><td>${escapeHtml(cal.quality || "—")}</td></tr>
          <tr><td>Muestras calibración</td><td>${cal.samples || 0}</td></tr>
          <tr><td>Mejor precisión calibración</td><td>${formatMeters(cal.best)}</td></tr>
          <tr><td>Precisión media calibración</td><td>${formatMeters(cal.avg)}</td></tr>
          <tr><td>Inicio forzado baja precisión</td><td>${w.forcedStart ? "Sí" : "No"}</td></tr>
          <tr><td>Precisión media trabajo</td><td>${formatMeters(avgAcc)}</td></tr>
          <tr><td>Peor precisión trabajo</td><td>${formatMeters(gps.worst)}</td></tr>
          <tr><td>Puntos originales</td><td>${(w.pointsOriginal || []).length}</td></tr>
          <tr><td>Puntos ruta depurada</td><td>${(w.pointsClean || []).length}</td></tr>
          <tr><td>Puntos dudosos / descartados</td><td>${gps.doubtful || 0} / ${gps.discarded || 0}</td></tr>
        </table>
      </div>
    `;
  }

  function renderReportEvents(w){
    const rows = (w.events || []).map(ev => `<tr><td>${ev.timeLabel}</td><td>${escapeHtml(ev.type)}</td><td>${escapeHtml(ev.label)}</td><td>${formatMeters(ev.accuracy)}</td><td>${escapeHtml(ev.notes || "")}</td></tr>`).join("");
    $("reportContent").innerHTML = `<div class="scroll-box"><table><tr><th>Hora</th><th>Evento</th><th>Punto</th><th>GPS</th><th>Observación</th></tr>${rows || "<tr><td colspan='5'>Sin eventos</td></tr>"}</table></div>`;
  }

  function renderReportIncidents(w){
    const rows = (w.incidents || []).map(i => `<tr><td>${i.timeLabel}</td><td>${escapeHtml(i.type)}</td><td>${escapeHtml(i.status)}</td><td>${formatMeters(i.accuracy)}${i.gpsMissing ? "<br><strong>Sin coordenada</strong>" : ""}</td><td>${escapeHtml(i.notes || "")}${i.photo ? `<br><img class="incident-thumb" src="${i.photo}" alt="Foto incidencia" />` : ""}</td></tr>`).join("");
    $("reportContent").innerHTML = `<div class="scroll-box"><table><tr><th>Hora</th><th>Tipo</th><th>Estado</th><th>GPS</th><th>Observación / foto</th></tr>${rows || "<tr><td colspan='5'>Sin incidencias</td></tr>"}</table></div>`;
  }

  function renderReportExport(w){
    $("reportContent").innerHTML = `
      <div class="scroll-box export-grid">
        <button class="btn primary full" id="shareReport">Compartir resumen</button>
        <button class="btn ghost full" id="downloadJson">Exportar JSON completo</button>
        <button class="btn ghost full" id="downloadCsv">Exportar CSV eventos</button>
        <button class="btn ghost full" id="downloadGeojson">Exportar ruta GeoJSON</button>
        <button class="btn ghost full" id="downloadGpx">Exportar ruta GPX</button>
        <button class="btn ghost full" id="downloadKml">Exportar ruta KML</button>
        <button class="btn ghost full" id="printReport">Imprimir / Guardar PDF</button>
        <p>Los archivos se generan localmente desde este dispositivo.</p>
      </div>`;
    $("shareReport").onclick = () => shareReportSummary(w);
    $("downloadJson").onclick = () => downloadBlob(safeFilename(w, "trabajo", "json"), JSON.stringify(w, null, 2), "application/json");
    $("downloadCsv").onclick = () => exportEventsCsv(w);
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

  function renderHistory(){
    const hist = storage.get(LS.history, []);
    $("historyList").innerHTML = hist.length ? hist.map((w,idx)=>`
      <button class="history-card history-button" data-history-index="${idx}">
        <strong>${escapeHtml(w.parcel)} · ${escapeHtml(w.type)}</strong>
        <small>${w.finishedAt ? new Date(w.finishedAt).toLocaleString("es-ES") : "Sin finalizar"} · ${((w.distanceM || 0)/1000).toFixed(2).replace(".", ",")} km · ${w.refills||0} recargas · ${(w.incidents||[]).length} incidencias</small>
      </button>`).join("") : "<p>No hay trabajos guardados.</p>";
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
    $("openHistoryFromDay").onclick = () => show("screen-history");
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
      }
      show("screen-parcel-detail");
    };
    $("centerTractor").onclick = () => {
      state.trackingFollow = true;
      if(state.currentPos && state.maps.work) state.maps.work.setView([state.currentPos.lat, state.currentPos.lng], 18);
    };

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
      if(b.dataset.reportTab === "events") renderReportEvents(w);
      if(b.dataset.reportTab === "incidents") renderReportIncidents(w);
      if(b.dataset.reportTab === "export") renderReportExport(w);
    }));

    $("clearHistory").onclick = () => {
      if(confirm("¿Borrar historial local de este dispositivo?")){
        storage.remove(LS.history); renderHistory();
      }
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
    }, 3200);
  }

  window.addEventListener("load", init);
})();