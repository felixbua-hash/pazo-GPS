(() => {
  "use strict";

  const VERSION = "Beta v9.6.1";
  const LS = {
    map: "pbgps_parcel_geojson_v08",
    incidentLayer: "pbgps_incident_layer_geojson_v08",
    lists: "pbgps_lists_v08",
    day: "pbgps_day_config_v08",
    history: "pbgps_history_v08",
    incidents: "pbgps_incidents_v08",
    active: "pbgps_active_work_v08",
    layerSetId: "pbgps_selected_layer_set_v95"
  };

  const WIND_INTERVAL_MS = 30 * 60 * 1000;
  const WIND_FETCH_TIMEOUT_MS = 8000;
  const WIND_SOURCE_NAME = "Open-Meteo Forecast API";
  const WIND_SOURCE_DETAIL = "Viento a 10 m · modelo meteorológico interpolado · consulta automática online";

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
    reportHistoryIndex: null,
    tickerStarted: false,
    historyFilter: "all",
    parcelSelectReturnTo: "screen-map-load",
    historyReturnTo: "screen-map-load",
    pendingResumeAfterDay: null,
    liveSpeedKmh: null,
    activeLayerSetId: null,
    layersDirty: false,
    lastStorageWarningAt: 0,
    lastHeartbeatAt: Date.now()
  };

  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  const storage = {
    get(key, fallback=null){
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value){
      try{ localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch(err){ console.warn("No se pudo guardar en almacenamiento local", key, err); return false; }
    },
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
    if(screenId !== "screen-report" && $("reportMapShell")) $("reportMapShell").classList.remove("is-expanded");
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
    if(acc === null || acc === undefined || !isFinite(acc)) return {label:"Sin datos", cls:"muted"};
    if(acc <= 5) return {label:"Buena", cls:"good"};
    if(acc <= 10) return {label:"Aceptable", cls:"accept"};
    if(acc <= 20) return {label:"Límite", cls:"warn"};
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


  // Beta v9.5: conjuntos de capas independientes en IndexedDB.
  // Mantiene las claves v08 para leer instalaciones anteriores, sin emparejar
  // accidentalmente incidencias de una finca con parcelas de otra.
  const EMPTY_INCIDENT_LAYER = () => ({type:"FeatureCollection", features:[]});
  const layerDb = {
    async open(){
      if(!window.indexedDB) throw new Error("Este navegador no permite guardar varios conjuntos de capas.");
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("pazo_baion_local_v95", 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if(!db.objectStoreNames.contains("layerSets")) db.createObjectStore("layerSets", {keyPath:"id"});
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacén local."));
        request.onblocked = () => reject(new Error("Almacenamiento ocupado por otra pestaña."));
      });
    },
    async transact(mode, method, value){
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("layerSets", mode);
        const store = tx.objectStore("layerSets");
        const req = method === "getAll" ? store.getAll() : method === "get" ? store.get(value) : method === "put" ? store.put(value) : store.delete(value);
        let result;
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => { /* transaction rejection below */ };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onerror = () => { db.close(); reject(tx.error || req.error || new Error("No se pudo guardar el conjunto.")); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error("Se canceló el guardado.")); };
      });
    },
    getAll(){return this.transact("readonly", "getAll");},
    get(id){return this.transact("readonly", "get", id);},
    put(value){return this.transact("readwrite", "put", value);},
    delete(id){return this.transact("readwrite", "delete", id);}
  };

  function setLayerStatusEmpty(){
    $("incidentLayerStatus").className = "status-card muted";
    $("incidentLayerStatus").textContent = "Incidencias: pendientes de seleccionar. Si no existen, se guardará una capa vacía.";
  }

  function setLayerSetInfo(){
    const label = $("layerSetName").value.trim();
    $("activeLayerSetInfo").textContent = state.layersDirty
      ? "Cambios sin guardar como conjunto" + (label ? ` · ${label}` : ". Escribe un nombre para conservarlos.")
      : state.activeLayerSetId ? `Conjunto guardado activo: ${label || "seleccionado"}` : "Capas actuales sin un conjunto guardado con nombre.";
  }

  function updateLayerButtons(){
    updateContinueAvailability();
    $("saveLayerSet").disabled = !isValidParcelsGeoJSON(state.parcelsGeoJSON);
    setLayerSetInfo();
  }

  async function refreshLayerSets(){
    const sel = $("savedLayerSetSelect");
    try{
      const sets = (await layerDb.getAll()).sort((a,b) => String(a.name).localeCompare(String(b.name), "es"));
      const current = sel.value || state.activeLayerSetId;
      sel.innerHTML = "";
      if(!sets.length){
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Todavía no hay conjuntos guardados";
        sel.appendChild(option);
      }
      for(const set of sets){
        const option = document.createElement("option");
        option.value = set.id;
        option.textContent = `${set.name} · ${(set.parcelsGeoJSON?.features || []).length} parcelas`;
        sel.appendChild(option);
      }
      if(sets.some(item => item.id === current)) sel.value = current;
      $("savedSetCount").textContent = `(${sets.length})`;
      $("loadLayerSet").disabled = !sets.length;
      $("deleteLayerSet").disabled = !sets.length;
      return sets;
    }catch(err){
      sel.innerHTML = '<option value="">Almacenamiento de conjuntos no disponible</option>';
      $("savedSetCount").textContent = "";
      $("loadLayerSet").disabled = true;
      $("deleteLayerSet").disabled = true;
      console.warn("No se pudieron leer los conjuntos guardados", err);
      return [];
    }
  }

  function setActiveLayers(gj, incidents, set=null){
    if(!isValidParcelsGeoJSON(gj)) throw new Error("El conjunto no contiene parcelas válidas.");
    state.parcelsGeoJSON = gj;
    state.incidentsGeoJSON = isValidIncidentsGeoJSON(incidents) ? incidents : EMPTY_INCIDENT_LAYER();
    state.selectedFeature = null;
    state.selectedParcelName = "";
    state.activeLayerSetId = set?.id || null;
    state.layersDirty = false;
    $("layerSetName").value = set?.name || "";
    renderParcelPreview(state.parcelsGeoJSON);
    renderIncidentLayerStatus(state.incidentsGeoJSON);
    storage.set(LS.map, state.parcelsGeoJSON);
    storage.set(LS.incidentLayer, state.incidentsGeoJSON);
    if(set) storage.set(LS.layerSetId, set.id);
    else storage.remove(LS.layerSetId);
    updateLayerButtons();
  }

  async function initSavedLayerSets(){
    try{
      // Se importa una única vez el último par de capas de v9.4, sin borrar el original.
      const legacy = storage.get(LS.map, null);
      if(isValidParcelsGeoJSON(legacy)){
        const old = await layerDb.get("legacy-v94");
        if(!old){
          const inc = storage.get(LS.incidentLayer, null);
          await layerDb.put({id:"legacy-v94", name:"Capas anteriores (v9.4)",
            parcelsGeoJSON:legacy, incidentsGeoJSON:isValidIncidentsGeoJSON(inc) ? inc : EMPTY_INCIDENT_LAYER(),
            savedAt:new Date().toISOString(), migrated:true});
        }
      }
      const id = storage.get(LS.layerSetId, null);
      if(id){
        const latest = await layerDb.get(id);
        if(latest) setActiveLayers(latest.parcelsGeoJSON, latest.incidentsGeoJSON, latest);
      }
      await refreshLayerSets();
      updateLayerButtons();
    }catch(err){
      console.warn("No se pudo completar la migración de conjuntos", err);
      updateLayerButtons();
    }
  }

  async function saveNamedLayerSet(){
    if(!isValidParcelsGeoJSON(state.parcelsGeoJSON)) return toast("Selecciona primero el archivo de parcelas.");
    const name = $("layerSetName").value.trim().replace(/\s+/g, " ");
    if(!name){ $("layerSetName").focus(); return toast("Escribe un nombre para distinguir este conjunto de parcelas."); }
    const all = await refreshLayerSets();
    const existing = all.find(x => x.name.toLocaleLowerCase("es") === name.toLocaleLowerCase("es"));
    if(existing && existing.id !== state.activeLayerSetId && !confirm(`Ya existe el conjunto «${existing.name}». ¿Sustituir sus capas por las seleccionadas?`)) return;
    const id = existing?.id || (state.activeLayerSetId && !state.layersDirty ? state.activeLayerSetId : `set-${Date.now()}-${Math.random().toString(36).slice(2,9)}`);
    const obj = {id, name, parcelsGeoJSON:state.parcelsGeoJSON,
      incidentsGeoJSON:isValidIncidentsGeoJSON(state.incidentsGeoJSON) ? state.incidentsGeoJSON : EMPTY_INCIDENT_LAYER(),
      savedAt:new Date().toISOString()};
    try{
      await layerDb.put(obj);
      state.activeLayerSetId = id;
      state.layersDirty = false;
      storage.set(LS.layerSetId, id);
      await refreshLayerSets();
      $("savedLayerSetSelect").value = id;
      setLayerSetInfo();
      toast(`Conjunto «${name}» guardado con sus capas de parcelas e incidencias.`);
    }catch(err){
      toast("No se pudo guardar el conjunto: " + err.message + ". Conserva los GeoJSON originales.");
    }
  }

  function ensureNoUnsecuredWork(reason="cambiar de conjunto"){
    const active = storage.get(LS.active, null);
    const w = state.work && !workIsCompleted(state.work) ? state.work : active;
    if(!w || workIsCompleted(w)) return true;
    if(!confirm(`Hay un trabajo sin finalizar (${w.parcel || "parcela"}). Para ${reason} se guardará como pendiente. ¿Continuar?`)) return false;
    if(w.status === "trabajando") closeInterruptedWork(w, Date.now(), "Cambio de parcela/conjunto");
    if(!saveHistorySnapshotProtected({...w, status:"pendiente"}, "trabajo pendiente antes de cambiar de conjunto")) return false;
    if(!storage.set(LS.active, w)){
      toast("No se pudo asegurar el trabajo activo. Cambio cancelado.");
      return false;
    }
    stopGpsWatch();
    state.work = null;
    return true;
  }

  async function loadNamedLayerSet(){
    const id = $("savedLayerSetSelect").value;
    if(!id) return toast("Elige un conjunto guardado.");
    if(state.layersDirty && !confirm("Hay capas nuevas sin guardar como conjunto. ¿Descartarlas y cargar el conjunto seleccionado?")) return;
    if(!ensureNoUnsecuredWork("cargar otras parcelas")) return;
    try{
      const set = await layerDb.get(id);
      if(!set) throw new Error("Ya no existe el conjunto elegido.");
      setActiveLayers(set.parcelsGeoJSON, set.incidentsGeoJSON, set);
      toast(`Conjunto «${set.name}» cargado. Pulsa «Continuar al mapa» para utilizarlo.`);
    }catch(err){ toast("No se pudo cargar el conjunto: " + err.message); }
  }

  async function deleteNamedLayerSet(){
    const id = $("savedLayerSetSelect").value;
    if(!id) return;
    const set = await layerDb.get(id);
    if(!set || !confirm(`¿Eliminar del dispositivo el conjunto «${set.name}»? Esta acción no elimina los GeoJSON originales ni el historial.`)) return;
    try{
      await layerDb.delete(id);
      if(state.activeLayerSetId === id){ state.activeLayerSetId = null; state.layersDirty = true; storage.remove(LS.layerSetId); }
      await refreshLayerSets();
      setLayerSetInfo();
    }catch(err){ toast("No se pudo eliminar el conjunto: " + err.message); }
  }

  function saveParcelsLayer(gj){
    // Elegir nuevas parcelas inicia otro conjunto: nunca conservar las incidencias de la finca anterior.
    state.parcelsGeoJSON = gj;
    state.incidentsGeoJSON = null;
    state.selectedFeature = null;
    state.selectedParcelName = "";
    state.activeLayerSetId = null;
    state.layersDirty = true;
    storage.remove(LS.layerSetId);
    storage.remove(LS.incidentLayer);
    setLayerStatusEmpty();
    if(!storage.set(LS.map, gj)){
      toast("No se guardaron las parcelas en la memoria clásica. Para conservar varios conjuntos utiliza «Guardar conjunto».");
    }
    renderParcelPreview(gj);
    updateLayerButtons();
  }

  // Compatibilidad con nombre anterior.
  function saveMap(gj){ saveParcelsLayer(gj); }

  function saveIncidentsLayer(gj){
    state.incidentsGeoJSON = gj;
    state.activeLayerSetId = null;
    state.layersDirty = true;
    storage.remove(LS.layerSetId);
    if(!storage.set(LS.incidentLayer, gj)) toast("No se guardó la capa de incidencias en el almacenamiento clásico. Utiliza «Guardar conjunto».");
    renderIncidentLayerStatus(gj);
    updateLayerButtons();
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
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }

  function formatDayDate(date=new Date()){
    const formatted = new Intl.DateTimeFormat("es-ES", {weekday:"long", day:"numeric", month:"long", year:"numeric"}).format(date);
    // Solo el día de la semana lleva inicial mayúscula; «de» y el mes permanecen en minúsculas.
    return formatted.replace(/^./u, letter => letter.toLocaleUpperCase("es-ES"));
  }

  function loadSavedDayConfig(){
    $("dayDateLabel").textContent = formatDayDate();
    const day = storage.get(LS.day, null);
    if(day){
      $("operatorSelect").value = day.operator || $("operatorSelect").value;
      $("tractorSelect").value = day.tractor || $("tractorSelect").value;
      $("sprayerSelect").value = day.sprayer || $("sprayerSelect").value;
      // Las observaciones son específicas de cada jornada y no se arrastran de un día anterior.
      $("dayNotes").value = day.date === todayIso() ? (day.notes || "") : "";
      state.dayConfig = day;
    }
  }

  function closePreviousDayDialog(){
    $("previousDayModal").classList.add("hidden");
    $("previousDayHelpModal").classList.add("hidden");
  }

  function offerPreviousDayConfig(day){
    const prior = new Date(`${day.date}T12:00:00`);
    const dateLabel = Number.isFinite(prior.getTime())
      ? new Intl.DateTimeFormat("es-ES", {day:"numeric", month:"long", year:"numeric"}).format(prior)
      : String(day.date);
    $("previousDayMessage").textContent = `Hay una configuración guardada del ${dateLabel}. ¿Deseas utilizar los mismos datos hoy o revisarlos antes de continuar al mapa?`;
    $("previousDayModal").classList.remove("hidden");
  }

  function usePreviousDayConfig(){
    const day = storage.get(LS.day, null);
    if(!day || !day.date || day.date === todayIso()){
      closePreviousDayDialog();
      goAfterMapReady();
      return;
    }
    const cfg = {...day, date:todayIso(), notes:""};
    if(!storage.set(LS.day, cfg)){
      toast("No se pudo guardar la nueva jornada. No se han modificado los datos anteriores.");
      return;
    }
    state.dayConfig = cfg;
    closePreviousDayDialog();
    loadSavedDayConfig();
    state.parcelSelectReturnTo = "screen-map-load";
    show("screen-parcel-select");
  }

  function modifyPreviousDayConfig(){
    closePreviousDayDialog();
    loadSavedDayConfig();
    show("screen-day-config");
  }

  function saveDayConfig(){
    const cfg = {
      date: todayIso(),
      operator: $("operatorSelect").value,
      tractor: $("tractorSelect").value,
      sprayer: $("sprayerSelect").value,
      notes: $("dayNotes").value.trim()
    };
    if(!storage.set(LS.day, cfg)){
      toast("No fue posible guardar la jornada en este dispositivo. No se ha continuado para evitar una pérdida silenciosa.");
      return;
    }
    state.dayConfig = cfg;
    // Si la jornada se preparó desde la ficha de un pendiente, continuar esa ficha.
    const pendingId = state.pendingResumeAfterDay;
    state.pendingResumeAfterDay = null;
    if(pendingId && state.reportWork && state.reportWork.id === pendingId && !workIsCompleted(state.reportWork)){
      resumePendingWorkFromReport();
      return;
    }
    state.parcelSelectReturnTo = "screen-day-config";
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
    const incidents = storage.get(LS.incidents, []).filter(i => i.parcel === state.selectedParcelName && isValidRoutePoint(i));
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
    if(!ensureNoUnsecuredWork("iniciar un nuevo trabajo")) return;
    if(!state.gpsCalibration) state.gpsCalibration = {samples:0, best:Infinity, avg:Infinity, quality:"No comprobado", forced, at:new Date().toISOString()};
    state.gpsCalibration.forced = forced;

    state.work = {
      id: "trabajo-" + Date.now(),
      parcel: state.selectedParcelName,
      parcelId: parcelIdentity(state.selectedFeature),
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
      windMode: isPhytosanitaryWorkType(state.workType) ? "automatico_30_min" : "no_aplicable",
      windSource: isPhytosanitaryWorkType(state.workType) ? WIND_SOURCE_NAME : null,
      segments: [],
      stopLog: [],
      currentSegmentId: null,
      currentStopId: null,
      nextWindPromptAt: null,
      lastGpsAt: null,
      lastEventAt: null,
      finalSnapshot: null,
      forcedStart: forced
    };
    if(!storage.set(LS.active, state.work)){
      toast("No se puede iniciar el trabajo: el navegador no permite guardar su ficha activa.");
      state.work = null;
      return;
    }
    state.reportWork = null;
    state.reportOrigin = "work";
    resetLiveUi();
    show("screen-work");
  }

  function setupWorkMap(){
    if(!state.work) return;
    const feature = state.work.parcelFeature || findParcelFeatureByName(state.work.parcel, state.work.parcelId) || state.selectedFeature;
    if(feature){
      state.selectedFeature = feature;
      state.work.parcelFeature = state.work.parcelFeature || feature;
    }
    waitForMapContainer("mapWork", () => {
      const map = makeMap("mapWork", "work");
      if(!map) return;
      if(feature){
        state.layers.workParcel = L.geoJSON(feature, { style: parcelStyle(true) }).addTo(map).bringToFront();
        const b = state.layers.workParcel.getBounds();
        if(b.isValid()) stabilizeMap(map, b, [42,42]);
      }
      drawImportedIncidents(map, "workImportedIncidents");
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
    state.liveSpeedKmh = null;
    $("liveSpeed").textContent = "0,0";
    $("partialTime").textContent = "00:00";
    $("totalTime").textContent = "00:00";
    $("distanceKm").textContent = "0,00";
    $("liveAccuracy").textContent = "—";
    $("refillCount").textContent = "0";
    updateWindUi();
  }


  function prepareWorkScreenFromState(){
    if(!state.work) return;
    ensureTimeline(state.work);
    recoverRouteForReport(state.work);

    state.selectedParcelName = state.work.parcel || state.selectedParcelName || "Parcela sin nombre";
    state.workType = state.work.type || state.workType || "Trabajo sin tipo";
    state.selectedFeature = state.work.parcelFeature || findParcelFeatureByName(state.work.parcel) || state.selectedFeature || null;
    if(state.selectedFeature) state.work.parcelFeature = state.work.parcelFeature || state.selectedFeature;
    state.dayConfig = state.work.day || state.dayConfig || storage.get(LS.day, {});
    state.gpsCalibration = state.work.gpsCalibration || state.gpsCalibration;

    const headerText = `${state.selectedParcelName} · ${state.workType}`;
    if($("workHeader")) $("workHeader").textContent = headerText;
    if($("selectedParcelName")) $("selectedParcelName").textContent = state.selectedParcelName;
    if($("workTypeParcel")) $("workTypeParcel").textContent = state.selectedParcelName;

    $("distanceKm").textContent = ((state.work.distanceM || 0)/1000).toFixed(2).replace(".", ",");
    $("refillCount").textContent = String(state.work.refills || 0);

    if(workIsCompleted(state.work)){
      $("beginWorkBtn").classList.add("hidden");
      $("stopWorkBtn").classList.add("hidden");
      $("continueWorkBtn").classList.add("hidden");
      setWorkStateUi("Finalizado");
      stopGpsWatch();
    } else if(state.work.status === "parado"){
      $("beginWorkBtn").classList.add("hidden");
      $("stopWorkBtn").classList.add("hidden");
      $("continueWorkBtn").classList.remove("hidden");
      setWorkStateUi("Parado");
    } else if(state.work.status === "trabajando" || state.work.startedAt){
      state.work.status = "trabajando";
      $("beginWorkBtn").classList.add("hidden");
      $("stopWorkBtn").classList.remove("hidden");
      $("continueWorkBtn").classList.add("hidden");
      setWorkStateUi("Trabajando");
      startGpsWatch();
    } else {
      $("beginWorkBtn").classList.remove("hidden");
      $("stopWorkBtn").classList.add("hidden");
      $("continueWorkBtn").classList.add("hidden");
      setWorkStateUi("Preparado");
    }

    updateLiveStats();
    updateRouteLayers();
    updateWindControls();
    if(!state.tickerStarted){
      state.tickerStarted = true;
      tick();
    }
  }

  function setPendingActionBusy(busy){
    const resume = $("resumePendingWorkBtn");
    const finish = $("finishPendingWorkBtn");
    if(resume) resume.disabled = !!busy;
    if(finish) finish.disabled = !!busy;
  }

  function activatePendingWorkFromReport(){
    const w = getReportWork();
    if(!w || workIsCompleted(w)) return null;
    const current = state.work && !workIsCompleted(state.work) ? state.work : storage.get(LS.active, null);
    if(current && current.id !== w.id && !ensureNoUnsecuredWork("retomar otro trabajo")) return null;
    state.work = clonePlain(w);
    const lastPhase = sortedTimelineEvents(state.work).slice(-1)[0]?._kind;
    if(state.work.startedAt && ["trabajando","pendiente"].includes(state.work.status) && (state.work.status === "trabajando" || lastPhase === "start" || lastPhase === "resume" || !lastPhase)){
      state.work.status = "trabajando";
      closeInterruptedWork(state.work, lastKnownWorkAt(state.work) || Date.now(), "Recuperación de trabajo pendiente");
    }
    ensureTimeline(state.work);
    recoverRouteForReport(state.work);
    // Una ficha pendiente nunca vuelve a iniciar GPS sola.
    state.work.status = state.work.startedAt ? "parado" : "preparado";
    state.reportWork = null;
    state.reportOrigin = "work";
    state.reportHistoryIndex = null;
    prepareWorkScreenFromState();
    if(!persistActiveWork()) return null;
    if(!saveHistorySnapshot(state.work)){
      toast("El trabajo pendiente sigue en memoria activa, pero no se ha podido actualizar el historial.");
    }
    return state.work;
  }

  function resumePendingWorkFromReport(){
    const pending = getReportWork();
    if(!pending || workIsCompleted(pending)) return;
    const day = storage.get(LS.day, null);
    if(!day || day.date !== todayIso()){
      state.pendingResumeAfterDay = pending.id;
      toast("Para reanudar este trabajo pendiente, confirma primero la configuración de la jornada de hoy. La ficha permanece guardada en el historial.");
      closePreviousDayDialog();
      loadSavedDayConfig();
      show("screen-day-config");
      return;
    }
    // La ficha conserva su geometría; no se obliga a cargar de nuevo todas las capas para leerla.
    if(!pending.parcelFeature && !findParcelFeatureByName(pending.parcel, pending.parcelId)){
      toast("Este trabajo no incluye la geometría de su parcela. Carga primero las capas correspondientes antes de reanudarlo.");
      show("screen-map-load");
      return;
    }
    const w = activatePendingWorkFromReport();
    if(!w) return;
    show("screen-work");
  }

  async function finishPendingWorkFromReport(){
    const w = getReportWork();
    if(!w || workIsCompleted(w)) return;
    if(!confirm("¿Terminar ahora este trabajo pendiente y generar informe definitivo?")) return;
    setPendingActionBusy(true);
    try{
      // No finalizar otro trabajo si la activación del pendiente fue cancelada o falló.
      const activated = activatePendingWorkFromReport();
      if(!activated || activated.id !== w.id || state.work?.id !== w.id) return;
      const now = Date.now();
      if(shouldTrackWindForWork(state.work)) await recordAutomaticWind("fin");
      const p = await resolveEventPosition();
      if(state.work.status === "trabajando") closeWorkSegment(now, "Fin de tratamiento");
      addEvent("Fin de tratamiento", "Punto final", "Trabajo finalizado desde ficha pendiente", p, now);
      state.work.status = "finalizado";
      state.work.finishedAt = now;
      recoverRouteForReport(state.work);
      freezeFinalSnapshot(state.work);
      stopGpsWatch();
      updateLiveStats();
      const finalReport = normalizeWorkForReport(serializeWork(state.work), "work");
      state.reportWork = finalReport;
      state.reportOrigin = "work";
      saveFinishedWork();
      resetReportTabs();
      show("screen-report");
    } finally {
      setPendingActionBusy(false);
    }
  }

  function timeLabelFromMs(ms){
    return new Date(ms).toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"});
  }

  function dateTimeLabelFromMs(ms){
    return ms ? new Date(ms).toLocaleString("es-ES") : "—";
  }

  function toMs(value){
    if(value === null || value === undefined || value === "") return null;
    if(typeof value === "number" && isFinite(value)) return value;
    const n = Number(value);
    if(isFinite(n) && String(value).trim() !== "") return n;
    const d = new Date(value);
    const t = d.getTime();
    return isFinite(t) ? t : null;
  }

  function eventMs(ev){
    return toMs(ev?.at) || toMs(ev?.time) || null;
  }

  function lastKnownWorkAt(w){
    if(!w) return null;
    const times = [];
    const push = v => { const n = toMs(v); if(isFinite(n)) times.push(n); };
    push(w.startedAt);
    push(w.finishedAt);
    push(w.lastGpsAt);
    push(w.lastEventAt);
    push(w.pausedAt);
    (w.segments || []).forEach(seg => { push(seg.startAt); push(seg.endAt); });
    (w.stopLog || []).forEach(stop => { push(stop.at); push(stop.resumedAt); });
    (w.events || []).forEach(ev => push(eventMs(ev)));
    (w.pointsOriginal || []).forEach(pt => push(pt.time));
    (w.pointsClean || []).forEach(pt => push(pt.time));
    return times.length ? Math.max(...times) : null;
  }

  function reportClock(w, now=Date.now()){
    if(!w) return now;
    if(workIsCompleted(w)) return toMs(w.finishedAt) || toMs(w.finalSnapshot?.finishedAt) || lastKnownWorkAt(w) || now;
    // En informes provisionales no se usa Date.now() para evitar que un trabajo abierto
    // siga sumando horas si la app quedó en segundo plano o no se cerró correctamente.
    return lastKnownWorkAt(w) || now;
  }

  function liveClock(w, now=Date.now()){
    if(!w) return now;
    if(workIsCompleted(w)) return reportClock(w, now);
    return now;
  }

  function eventKind(ev){
    const t = String(ev?.type || "").toLowerCase();
    if(t.includes("comienzo")) return "start";
    if(t.includes("continu")) return "resume";
    if(t.includes("parada")) return "stop";
    if(t.includes("fin")) return "finish";
    return "";
  }

  function sortedTimelineEvents(w){
    return (Array.isArray(w?.events) ? w.events : [])
      .map(ev => ({...ev, _ms:eventMs(ev), _kind:eventKind(ev)}))
      .filter(ev => ev._ms && ev._kind)
      .sort((a,b) => a._ms - b._ms);
  }

  function stopReasonFromEvent(ev){
    return String(ev?.label || ev?.notes || ev?.type || "Parada").trim() || "Parada";
  }

  function buildTimelineFromEvents(w, clock=Date.now(), options={}){
    const events = sortedTimelineEvents(w);
    const startEv = events.find(ev => ev._kind === "start");
    const started = toMs(w?.startedAt) || startEv?._ms || null;
    if(!started) return null;

    const clockMs = toMs(clock) || Date.now();
    let finished = toMs(w?.finishedAt) || toMs(w?.finalSnapshot?.finishedAt) || null;
    const finishEv = events.slice().reverse().find(ev => ev._kind === "finish");
    if(!finished && finishEv) finished = finishEv._ms;
    const endLimit = finished || clockMs;
    const includeOpen = options.includeOpen !== false;

    let phase = "active";
    let cursor = started;
    let stopOpenedBy = null;
    const segments = [];
    const stops = [];
    let activeMs = 0;
    let stoppedMs = 0;

    const addSegment = (start, end, reason="") => {
      start = toMs(start); end = toMs(end);
      if(!start || !end || end < start) return;
      const ms = Math.max(0, end - start);
      activeMs += ms;
      segments.push({
        id: "seg-evt-" + start + "-" + segments.length,
        index: segments.length + 1,
        startAt: start,
        startLabel: timeLabelFromMs(start),
        endAt: end,
        endLabel: timeLabelFromMs(end),
        activeMs: ms,
        closeReason: reason || ""
      });
    };

    const addStop = (start, end, ev=null) => {
      start = toMs(start); end = toMs(end);
      if(!start || !end || end < start) return;
      const interruption = /interrupci[oó]n|reapertura|cambio de parcela\/conjunto/i.test(stopReasonFromEvent(ev));
      const ms = interruption ? 0 : Math.max(0, end - start);
      stoppedMs += ms;
      stops.push({
        id: "stop-evt-" + start + "-" + stops.length,
        eventId: ev?.id || null,
        at: start,
        timeLabel: timeLabelFromMs(start),
        reason: stopReasonFromEvent(ev),
        refillNumber: ev?.refillNumber || null,
        resumedAt: end,
        resumedLabel: timeLabelFromMs(end),
        stoppedMs: ms,
        excludedFromStoppedTime: interruption
      });
    };

    for(const ev of events){
      const ms = ev._ms;
      if(ms < started) continue;
      if(finished && ms > finished) continue;
      if(ev._kind === "start") continue;

      if(ev._kind === "stop"){
        if(phase === "active"){
          addSegment(cursor, ms, stopReasonFromEvent(ev));
          phase = "stopped";
          cursor = ms;
          stopOpenedBy = ev;
        }
        continue;
      }

      if(ev._kind === "resume"){
        if(phase === "stopped"){
          addStop(cursor, ms, stopOpenedBy);
          phase = "active";
          cursor = ms;
          stopOpenedBy = null;
        }
        continue;
      }

      if(ev._kind === "finish"){
        finished = ms;
        if(phase === "active") addSegment(cursor, ms, ev.label || "Fin");
        else if(phase === "stopped") addStop(cursor, ms, stopOpenedBy || ev);
        phase = "finished";
        cursor = ms;
        stopOpenedBy = null;
        break;
      }
    }

    if(includeOpen && phase !== "finished"){
      if(phase === "active" && (w?.status === "trabajando" || finished)){
        addSegment(cursor, endLimit, finished ? "Fin" : "en curso");
      } else if(phase === "stopped" && (w?.status === "parado" || finished)){
        addStop(cursor, endLimit, stopOpenedBy);
      }
    }

    const elapsedEnd = finished || (includeOpen ? endLimit : lastKnownWorkAt(w) || endLimit);
    const excludedGapMs = stops.filter(x=>x.excludedFromStoppedTime).reduce((sum,x)=>sum+Math.max(0,(toMs(x.resumedAt)||elapsedEnd) - (toMs(x.at)||elapsedEnd)),0);
    return {
      source: "events",
      startedAt: started,
      finishedAt: finished,
      activeMs: Math.max(0, activeMs),
      stoppedMs: Math.max(0, stoppedMs),
      elapsedMs: started ? Math.max(0, elapsedEnd - started - excludedGapMs) : Math.max(0, activeMs + stoppedMs),
      segments,
      stops,
      currentActiveMs: phase === "active" && includeOpen ? Math.max(0, endLimit - cursor) : 0,
      currentStoppedMs: phase === "stopped" && includeOpen ? Math.max(0, endLimit - cursor) : 0
    };
  }

  function buildTimelineFromLogs(w, clock=Date.now(), options={}){
    ensureTimeline(w);
    const clockMs = toMs(clock) || Date.now();
    const started = toMs(w?.startedAt) || toMs((w?.segments || [])[0]?.startAt) || null;
    const finished = toMs(w?.finishedAt) || toMs(w?.finalSnapshot?.finishedAt) || null;
    const includeOpen = options.includeOpen !== false;
    const endLimit = finished || clockMs;

    const segments = (w?.segments || []).map((seg, i) => {
      const start = toMs(seg.startAt);
      const rawEnd = toMs(seg.endAt);
      const open = start && !rawEnd && includeOpen && (w?.status === "trabajando" || finished);
      const end = rawEnd || (open ? endLimit : null);
      const ms = start && end ? Math.max(0, end - start) : Math.max(0, Number(seg.activeMs) || 0);
      return {
        ...seg,
        index: i + 1,
        startAt: start || seg.startAt,
        startLabel: seg.startLabel || (start ? timeLabelFromMs(start) : "—"),
        endAt: end || null,
        endLabel: end ? timeLabelFromMs(end) : seg.endLabel || null,
        activeMs: ms
      };
    }).filter(seg => toMs(seg.startAt));

    const stops = (w?.stopLog || []).map((stop, i) => {
      const start = toMs(stop.at);
      const rawEnd = toMs(stop.resumedAt);
      const open = start && !rawEnd && includeOpen && (w?.status === "parado" || finished);
      const end = rawEnd || (open ? endLimit : null);
      const interruption = stop.excludedFromStoppedTime || /interrupci[oó]n|reapertura|cambio de parcela\/conjunto/i.test(stop.reason || "");
      const ms = interruption ? 0 : (start && end ? Math.max(0, end - start) : Math.max(0, Number(stop.stoppedMs) || 0));
      return {
        ...stop,
        index: i + 1,
        at: start || stop.at,
        timeLabel: stop.timeLabel || (start ? timeLabelFromMs(start) : "—"),
        resumedAt: end || null,
        resumedLabel: end ? timeLabelFromMs(end) : stop.resumedLabel || null,
        stoppedMs: ms
      };
    }).filter(stop => toMs(stop.at));

    let activeMs = segments.reduce((sum, seg) => sum + Math.max(0, Number(seg.activeMs) || 0), 0);
    let stoppedMs = stops.reduce((sum, stop) => sum + Math.max(0, Number(stop.stoppedMs) || 0), 0);
    if(!segments.length) activeMs = Math.max(0, Number(w?.activeMs) || 0);
    if(!stops.length) stoppedMs = Math.max(0, Number(w?.stoppedMs) || 0);
    const elapsedEnd = finished || (includeOpen ? endLimit : lastKnownWorkAt(w) || endLimit);
    const excludedGapMs = stops.filter(x=>x.excludedFromStoppedTime).reduce((sum,x)=>sum+Math.max(0,(toMs(x.resumedAt)||elapsedEnd)-(toMs(x.at)||elapsedEnd)),0);
    return {
      source: "logs",
      startedAt: started,
      finishedAt: finished,
      activeMs,
      stoppedMs,
      elapsedMs: started ? Math.max(0, elapsedEnd - started - excludedGapMs) : Math.max(0, activeMs + stoppedMs),
      segments,
      stops,
      currentActiveMs: w?.status === "trabajando" && segments.length ? Math.max(0, Number(segments.at(-1).activeMs) || 0) : 0,
      currentStoppedMs: w?.status === "parado" && stops.length ? Math.max(0, Number(stops.at(-1).stoppedMs) || 0) : 0
    };
  }

  function workTimeline(w, clock=Date.now(), options={}){
    const fromEvents = buildTimelineFromEvents(w, clock, options);
    if(fromEvents && ((w?.events || []).some(ev => eventKind(ev)))) return fromEvents;
    return buildTimelineFromLogs(w, clock, options);
  }

  function timelineActiveMs(w, clock){
    const tl = workTimeline(w, clock, {includeOpen:true});
    if(tl && (tl.segments.length || tl.activeMs)) return Math.max(0, tl.activeMs);
    return Math.max(0, Number(w?.finalSnapshot?.activeMs) || Number(w?.activeMs) || 0);
  }

  function timelineStoppedMs(w, clock){
    const tl = workTimeline(w, clock, {includeOpen:true});
    if(tl && (tl.stops.length || tl.stoppedMs)) return Math.max(0, tl.stoppedMs);
    return Math.max(0, Number(w?.finalSnapshot?.stoppedMs) || Number(w?.stoppedMs) || 0);
  }

  function inferFinishedAt(w){
    if(!w) return null;
    let t = toMs(w.finishedAt) || toMs(w.finalSnapshot?.finishedAt);
    if(t) return t;
    const fin = (w.events || []).slice().reverse().find(ev => String(ev.type || "").toLowerCase().includes("fin"));
    t = eventMs(fin);
    return t || null;
  }

  function closeOpenTimelineForFinal(w, endAt){
    if(!w) return w;
    ensureTimeline(w);
    const finishMs = toMs(endAt) || inferFinishedAt(w) || lastKnownWorkAt(w) || Date.now();
    (w.segments || []).forEach(seg => {
      const start = toMs(seg.startAt);
      if(start && !toMs(seg.endAt)){
        seg.endAt = finishMs;
        seg.endLabel = timeLabelFromMs(finishMs);
        seg.activeMs = Math.max(0, finishMs - start);
        seg.closeReason = seg.closeReason || "Fin";
      }
    });
    (w.stopLog || []).forEach(stop => {
      const start = toMs(stop.at);
      if(start && !toMs(stop.resumedAt)){
        stop.resumedAt = finishMs;
        stop.resumedLabel = timeLabelFromMs(finishMs);
        stop.stoppedMs = stop.excludedFromStoppedTime ? 0 : Math.max(0, finishMs - start);
      }
    });
    w.currentSegmentId = null;
    w.currentStopId = null;
    return w;
  }

  function buildFinalSnapshot(w){
    if(!w) return null;
    ensureTimeline(w);
    const started = toMs(w.startedAt) || eventMs(eventByName(w, "comienzo"));
    const finished = inferFinishedAt(w) || lastKnownWorkAt(w) || started || Date.now();
    closeOpenTimelineForFinal(w, finished);
    const tl = workTimeline(w, finished, {includeOpen:true});
    return {
      frozenAt: new Date().toISOString(),
      startedAt: started || w.startedAt || null,
      finishedAt: w.finishedAt || (finished ? finished : null),
      activeMs: Math.max(0, tl?.activeMs || 0),
      stoppedMs: Math.max(0, tl?.stoppedMs || 0),
      elapsedMs: Math.max(0, tl?.elapsedMs || ((started && finished) ? finished - started : 0)),
      distanceM: w.distanceM || 0,
      refills: w.refills || 0,
      stops: (tl?.stops || w.stopLog || []).filter(st=>!st.excludedFromStoppedTime).length || w.stops || 0,
      incidents: (w.incidents || []).length || 0,
      timeSource: tl?.source || "logs"
    };
  }

  function freezeFinalSnapshot(w){
    if(!w) return null;
    const finished = inferFinishedAt(w) || lastKnownWorkAt(w) || Date.now();
    w.finishedAt = toMs(w.finishedAt) || finished;
    w.status = "finalizado";
    closeOpenTimelineForFinal(w, w.finishedAt);
    w.finalSnapshot = buildFinalSnapshot(w);
    return w.finalSnapshot;
  }

  function ensureTimeline(w){
    if(!w) return w;
    if(!Array.isArray(w.segments)) w.segments = [];
    if(!Array.isArray(w.stopLog)) w.stopLog = [];
    const startedMs = toMs(w.startedAt);
    const finishedMs = toMs(w.finishedAt);
    if(startedMs && !w.segments.length && (w.activeMs || finishedMs)){
      const endAt = finishedMs || null;
      w.segments.push({
        id: "seg-legacy-1",
        index: 1,
        startAt: startedMs,
        startLabel: timeLabelFromMs(startedMs),
        endAt,
        endLabel: endAt ? timeLabelFromMs(endAt) : null,
        activeMs: w.activeMs || (endAt ? Math.max(0, endAt - startedMs) : 0),
        closeReason: endAt ? "Fin" : ""
      });
    }
    return w;
  }

  function openWorkSegment(now=Date.now()){
    if(!state.work) return null;
    ensureTimeline(state.work);
    const open = state.work.segments.find(s => !s.endAt);
    if(open){
      state.work.currentSegmentId = open.id;
      state.work.lastSegmentAt = open.startAt;
      return open;
    }
    const seg = {
      id: "seg-" + now,
      index: state.work.segments.length + 1,
      startAt: now,
      startLabel: timeLabelFromMs(now),
      endAt: null,
      endLabel: null,
      activeMs: 0,
      closeReason: ""
    };
    state.work.segments.push(seg);
    state.work.currentSegmentId = seg.id;
    state.work.lastSegmentAt = now;
    return seg;
  }

  function closeWorkSegment(now=Date.now(), reason=""){
    if(!state.work) return null;
    ensureTimeline(state.work);
    const seg = state.work.segments.find(s => s.id === state.work.currentSegmentId && !s.endAt) || state.work.segments.find(s => !s.endAt);
    if(!seg) return null;
    seg.endAt = now;
    seg.endLabel = timeLabelFromMs(now);
    seg.activeMs = Math.max(0, now - (seg.startAt || now));
    seg.closeReason = reason;
    state.work.activeMs = (state.work.activeMs || 0) + seg.activeMs;
    state.work.currentSegmentId = null;
    return seg;
  }

  function currentSegmentMs(w, now=Date.now(), options={}){
    const clock = options.live ? liveClock(w, now) : reportClock(w, now);
    const tl = workTimeline(w, clock, {includeOpen:true});
    if(w?.status === "parado") return Math.max(0, tl.currentStoppedMs || (tl.stops.at(-1)?.stoppedMs || 0));
    if(w?.status === "trabajando") return Math.max(0, tl.currentActiveMs || (tl.segments.at(-1)?.activeMs || 0));
    return Math.max(0, tl.segments.at(-1)?.activeMs || 0);
  }

  function activeElapsedMs(w, now=Date.now(), options={}){
    const clock = options.live ? liveClock(w, now) : reportClock(w, now);
    const tl = workTimeline(w, clock, {includeOpen:true});
    if(tl && (tl.segments.length || tl.activeMs)) return Math.max(0, tl.activeMs);
    if(workIsCompleted(w) && w?.finalSnapshot && isFinite(Number(w.finalSnapshot.activeMs))){
      return Math.max(0, Number(w.finalSnapshot.activeMs));
    }
    return Math.max(0, Number(w?.activeMs) || 0);
  }

  function stoppedElapsedMs(w, now=Date.now(), options={}){
    const clock = options.live ? liveClock(w, now) : reportClock(w, now);
    const tl = workTimeline(w, clock, {includeOpen:true});
    if(tl && (tl.stops.length || tl.stoppedMs)) return Math.max(0, tl.stoppedMs);
    if(workIsCompleted(w) && w?.finalSnapshot && isFinite(Number(w.finalSnapshot.stoppedMs))){
      return Math.max(0, Number(w.finalSnapshot.stoppedMs));
    }
    return Math.max(0, Number(w?.stoppedMs) || 0);
  }

  function markCurrentStopResumed(now=Date.now()){
    if(!state.work) return;
    ensureTimeline(state.work);
    const stop = (state.work.stopLog || []).find(s => s.id === state.work.currentStopId && !s.resumedAt) || (state.work.stopLog || []).slice().reverse().find(s => !s.resumedAt);
    if(stop){
      stop.resumedAt = now;
      stop.resumedLabel = timeLabelFromMs(now);
      stop.stoppedMs = stop.excludedFromStoppedTime ? 0 : Math.max(0, now - (stop.at || now));
    }
    state.work.currentStopId = null;
  }

  async function resolveEventPosition(){
    let p = freshPosition(state.currentPos) ? state.currentPos : null;
    if(!p){
      try{
        p = await getCurrentGpsPosition();
        state.currentPos = p;
        drawCurrentPosition(p);
      }catch(err){
        p = state.currentPos || state.gpsCalibration?.last || null;
      }
    }
    return p;
  }

  // Interrupciones: no computar como trabajo efectivo horas sin ejecución GPS.
  function closeInterruptedWork(w, at, reason="Interrupción del navegador"){
    if(!w || w.status !== "trabajando") return false;
    const last = Math.max(toMs(w.startedAt) || 0, toMs(at) || Date.now());
    ensureTimeline(w);
    const openSegment = (w.segments || []).find(seg => !seg.endAt);
    if(openSegment){
      const start = toMs(openSegment.startAt) || last;
      openSegment.endAt = Math.max(start, last);
      openSegment.endLabel = timeLabelFromMs(openSegment.endAt);
      openSegment.activeMs = Math.max(0, openSegment.endAt - start);
      openSegment.closeReason = reason;
      w.activeMs = (Number(w.activeMs) || 0) + openSegment.activeMs;
    }
    w.currentSegmentId = null;
    w.status = "parado";
    w.pausedAt = last;
    w.suspensionDetected = true;
    w.events = w.events || [];
    const evId = `ev-interrupcion-${last}`;
    if(!w.events.some(ev => ev.id === evId)) w.events.push({
      id:evId, type:"Parada", label:reason,
      notes:"Intervalo sin seguimiento GPS: no se cuenta como tiempo efectivo ni como parada de trabajo.",
      at:new Date(last).toISOString(), timeLabel:timeLabelFromMs(last),
      lat:null, lng:null, accuracy:null
    });
    w.stopLog = w.stopLog || [];
    const stopId = `stop-interrupcion-${last}`;
    if(!w.stopLog.some(stop => stop.id === stopId)) w.stopLog.push({id:stopId, eventId:evId,
      at:last, timeLabel:timeLabelFromMs(last), reason, resumedAt:null,
      resumedLabel:null, stoppedMs:0, excludedFromStoppedTime:true});
    w.currentStopId = stopId;
    return true;
  }

  function suspendCurrentWork(reason, at=Date.now()){
    if(!state.work || state.work.status !== "trabajando") return;
    closeInterruptedWork(state.work, at, reason);
    stopGpsWatch();
    persistActiveWork();
    if(document.querySelector("#screen-work.active")) prepareWorkScreenFromState();
  }

  function checkExecutionGap(now){
    if(state.work?.status === "trabajando" && state.lastHeartbeatAt && now - state.lastHeartbeatAt > 45000){
      suspendCurrentWork("Interrupción de seguimiento GPS", state.lastHeartbeatAt);
    }
    state.lastHeartbeatAt = now;
  }

  function persistActiveWork(){
    if(!state.work || workIsCompleted(state.work)) return true;
    const ok = storage.set(LS.active, state.work);
    if(!ok && Date.now() - state.lastStorageWarningAt > 60000){
      state.lastStorageWarningAt = Date.now();
      toast("ATENCIÓN: no se ha podido guardar el trabajo activo. Libera espacio del navegador y exporta una copia de seguridad desde el historial. No cierres la aplicación sin asegurar el trabajo.");
    }
    return ok;
  }

  async function beginWork(){
    if(!state.work || state.work.status === "trabajando") return;
    const btn = $("beginWorkBtn");
    btn.disabled = true;
    const previousText = btn.querySelector("small")?.textContent;
    if(btn.querySelector("small")) btn.querySelector("small").textContent = "Obteniendo GPS inicial...";
    try{
      startGpsWatch();
      const now = Date.now();
      const p = await resolveEventPosition();
      state.work.status = "trabajando";
      state.work.startedAt = now;
      state.work.lastSegmentAt = now;
      state.work.nextWindPromptAt = shouldTrackWindForWork(state.work) ? now : null;
      ensureTimeline(state.work);
      openWorkSegment(now);
      addEvent("Comienzo", "Punto inicial", "Inicio del trabajo", p, now);
      if(p){
        state.currentPos = p;
        appendGpsPointToWork(p, true);
        drawCurrentPosition(p);
      }
      $("beginWorkBtn").classList.add("hidden");
      $("stopWorkBtn").classList.remove("hidden");
      $("continueWorkBtn").classList.add("hidden");
      setWorkStateUi("Trabajando");
      state.trackingFollow = true;
      updateRouteLayers();
      updateLiveStats();
      persistActiveWork();
      centerWorkMapOnTractor(false);
      updateWindControls();
      if(shouldTrackWindForWork(state.work)) setTimeout(() => recordAutomaticWind("inicio"), 600);
      if(!state.tickerStarted){
        state.tickerStarted = true;
        tick();
      }
    } finally {
      btn.disabled = false;
      if(btn.querySelector("small") && previousText) btn.querySelector("small").textContent = previousText;
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

  function normalizePlainText(value){
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function isPhytosanitaryWorkType(type){
    const t = normalizePlainText(type);
    return t.includes("fitosanit");
  }

  function shouldTrackWindForWork(w){
    return isPhytosanitaryWorkType(w?.type || state.workType);
  }

  function windDirectionText(deg){
    if(deg === null || deg === undefined || deg === "") return "—";
    const n = Number(deg);
    if(!Number.isFinite(n)) return "—";
    const normalized = ((n % 360) + 360) % 360;
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
    const idx = Math.round(normalized / 22.5) % 16;
    return `${dirs[idx]} (${Math.round(normalized)}°)`;
  }

  function formatWindReading(reading){
    if(!reading) return "—";
    if(reading.status === "error"){
      return "Sin dato automático";
    }
    const parts = [formatWind(reading.kmh)];
    if(reading.directionDeg !== null && reading.directionDeg !== undefined && Number.isFinite(Number(reading.directionDeg))) parts.push(windDirectionText(reading.directionDeg));
    if(reading.gustKmh !== null && reading.gustKmh !== undefined && Number.isFinite(Number(reading.gustKmh))) parts.push(`racha ${formatWind(reading.gustKmh)}`);
    return parts.filter(Boolean).join(" · ");
  }

  function windStats(readings){
    const validReadings = (readings || []).filter(r => r && r.status === "ok" && r.kmh !== null && r.kmh !== undefined && r.kmh !== "" && Number.isFinite(Number(r.kmh)) && Number(r.kmh) >= 0);
    const arr = validReadings.map(r => Number(r.kmh));
    if(!arr.length) return { latest:null, avg:null, max:null, count:0, failed:(readings || []).filter(r => r.status === "error").length, latestReading:null };
    return {
      latest: arr[arr.length-1],
      avg: arr.reduce((a,b)=>a+b,0)/arr.length,
      max: Math.max(...arr),
      count: arr.length,
      failed: (readings || []).filter(r => r.status === "error").length,
      latestReading: validReadings[validReadings.length - 1] || null
    };
  }

  function updateWindControls(){
    const btn = $("windReadingBtn");
    if(!btn) return;
    const active = shouldTrackWindForWork(state.work);
    btn.classList.toggle("hidden", !active);
    const small = btn.querySelector("small");
    if(small) small.textContent = active ? "Viento auto" : "Viento";
    btn.title = active ? "Actualizar ahora el viento automáticamente" : "Viento no aplicable a este tipo de trabajo";
    btn.disabled = !active;
  }

  function updateWindUi(){
    const el = $("windSpeedValue");
    if(!el) return;
    updateWindControls();
    if(!shouldTrackWindForWork(state.work)){
      el.classList.remove("wind-green", "wind-amber", "wind-red");
      el.textContent = "No aplica";
      return;
    }
    const readings = state.work?.windReadings || [];
    const stats = windStats(readings);
    const last = readings[readings.length - 1] || null;
    const windLevel = stats.latestReading ? (stats.latest > 9 ? "wind-red" : stats.latest > 4.5 ? "wind-amber" : "wind-green") : "";
    el.classList.remove("wind-green", "wind-amber", "wind-red");
    if(windLevel) el.classList.add(windLevel);
    if(last?.status === "error" && !stats.latestReading){
      el.textContent = "Sin dato";
      return;
    }
    if(stats.latestReading){
      const dir = stats.latestReading.directionDeg !== null && stats.latestReading.directionDeg !== undefined && Number.isFinite(Number(stats.latestReading.directionDeg)) ? ` · ${windDirectionText(stats.latestReading.directionDeg).split(" ")[0]}` : "";
      el.textContent = `${formatWind(stats.latestReading.kmh)}${dir}`;
    } else {
      el.textContent = "Pendiente";
    }
  }

  function windCoordinatesForWork(w){
    const candidates = [];
    const push = (lat, lng, source) => {
      const la = Number(lat), lo = Number(lng);
      if(isValidRoutePoint({lat, lng})) candidates.push({lat:la, lng:lo, coordinateSource:source});
    };
    if(freshPosition(state.currentPos)) push(state.currentPos?.lat, state.currentPos?.lng, "GPS actual reciente del dispositivo");
    const lastClean = (w?.pointsClean || []).slice().reverse().find(isValidRoutePoint);
    push(lastClean?.lat, lastClean?.lng, "último punto GPS depurado");
    const lastOriginal = (w?.pointsOriginal || []).slice().reverse().find(isValidRoutePoint);
    push(lastOriginal?.lat, lastOriginal?.lng, "último punto GPS original");
    const startEvent = eventByName(w, "comienzo");
    push(startEvent?.lat, startEvent?.lng, "punto de comienzo");
    const pairs = featureCoordinatePairs(w?.parcelFeature || findParcelFeatureByName(w?.parcel));
    if(pairs.length){
      const lat = pairs.reduce((s,p)=>s+Number(p.lat),0) / pairs.length;
      const lng = pairs.reduce((s,p)=>s+Number(p.lng),0) / pairs.length;
      push(lat, lng, "centro aproximado de la parcela");
    }
    return candidates[0] || null;
  }

  function buildWindApiUrl(coords){
    const params = new URLSearchParams({
      latitude: coords.lat.toFixed(6),
      longitude: coords.lng.toFixed(6),
      current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      wind_speed_unit: "kmh",
      timezone: "auto"
    });
    return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  }

  function pushWindReading(reading){
    if(!state.work) return;
    state.work.windReadings = state.work.windReadings || [];
    state.work.windReadings.push(reading);
    state.work.nextWindPromptAt = Date.now() + WIND_INTERVAL_MS;
    updateWindUi();
    if(state.maps.work) drawWindArrows(state.maps.work, state.work.windReadings, "workWindArrows");
    persistActiveWork();
  }

  async function recordAutomaticWind(reason="periodico", options={}){
    if(!state.work || !shouldTrackWindForWork(state.work)) return null;
    if(state.windFetchInProgress) return null;
    state.windFetchInProgress = true;
    const now = Date.now();
    state.work.nextWindPromptAt = now + WIND_INTERVAL_MS;
    try{
      const coords = windCoordinatesForWork(state.work);
      if(!coords){
        const reading = {
          at: new Date(now).toISOString(),
          timeLabel: timeLabelFromMs(now),
          kmh: null,
          directionDeg: null,
          directionText: "—",
          gustKmh: null,
          automatic: true,
          autoPrompt: true,
          source: WIND_SOURCE_NAME,
          sourceDetail: WIND_SOURCE_DETAIL,
          status: "error",
          error: "Sin coordenadas GPS o de parcela suficientes para consultar viento.",
          reason
        };
        pushWindReading(reading);
        return reading;
      }

      const controller = window.AbortController ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), WIND_FETCH_TIMEOUT_MS) : null;
      const url = buildWindApiUrl(coords);
      const response = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      });
      if(timeout) clearTimeout(timeout);
      if(!response.ok) throw new Error(`Respuesta meteorológica ${response.status}`);
      const data = await response.json();
      const current = data.current || data.current_weather || {};
      const rawKmh = current.wind_speed_10m ?? current.windspeed;
      const rawDirection = current.wind_direction_10m ?? current.winddirection;
      const rawGust = current.wind_gusts_10m;
      const kmh = rawKmh === null || rawKmh === undefined ? NaN : Number(rawKmh);
      const directionDeg = rawDirection === null || rawDirection === undefined ? NaN : Number(rawDirection);
      const gustKmh = rawGust === null || rawGust === undefined ? NaN : Number(rawGust);
      if(!Number.isFinite(kmh) || kmh < 0) throw new Error("La respuesta no incluye velocidad de viento válida.");

      const reading = {
        at: new Date(now).toISOString(),
        timeLabel: timeLabelFromMs(now),
        weatherTime: current.time || null,
        kmh,
        directionDeg: isFinite(directionDeg) ? directionDeg : null,
        directionText: windDirectionText(directionDeg),
        gustKmh: isFinite(gustKmh) ? gustKmh : null,
        automatic: true,
        autoPrompt: true,
        source: WIND_SOURCE_NAME,
        sourceDetail: WIND_SOURCE_DETAIL,
        provider: "Open-Meteo",
        status: "ok",
        reason,
        lat: coords.lat,
        lng: coords.lng,
        coordinateSource: coords.coordinateSource,
        modelled: true
      };
      pushWindReading(reading);
      if(options.notify) toast(`Viento actualizado: ${formatWindReading(reading)}`);
      return reading;
    }catch(err){
      const reading = {
        at: new Date(now).toISOString(),
        timeLabel: timeLabelFromMs(now),
        kmh: null,
        directionDeg: null,
        directionText: "—",
        gustKmh: null,
        automatic: true,
        autoPrompt: true,
        source: WIND_SOURCE_NAME,
        sourceDetail: WIND_SOURCE_DETAIL,
        provider: "Open-Meteo",
        status: "error",
        error: err?.name === "AbortError" ? "Tiempo de espera agotado al consultar la fuente meteorológica." : (err?.message || "No se pudo consultar la fuente meteorológica."),
        reason
      };
      pushWindReading(reading);
      if(options.notify) toast(`No se pudo actualizar el viento: ${reading.error}`);
      return reading;
    }finally{
      state.windFetchInProgress = false;
    }
  }

  function checkWindPrompt(){
    if(!state.work || state.work.status !== "trabajando" || !shouldTrackWindForWork(state.work)) return;
    if(!state.work.nextWindPromptAt) state.work.nextWindPromptAt = Date.now();
    if(Date.now() >= state.work.nextWindPromptAt) recordAutomaticWind("periodico");
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

  function liveSpeedKmhFromPosition(p){
    const values = [];
    if(p.speed !== null && p.speed !== undefined && isFinite(p.speed) && p.speed > 0.15) values.push(p.speed * 3.6);
    const prev = state.work?.pointsClean?.at(-1) || state.work?.pointsOriginal?.at(-1) || null;
    if(prev && p.time && prev.time && p.time > prev.time){
      const dt = (p.time - prev.time) / 1000;
      const derived = haversine(prev, p) / Math.max(1, dt) * 3.6;
      if(dt >= 2 && dt <= 30 && isFinite(derived) && derived <= 18) values.push(derived);
    }
    if(!values.length && p.speed !== null && p.speed !== undefined && isFinite(p.speed) && p.speed >= 0) values.push(p.speed * 3.6);
    const raw = values.length ? values.reduce((a,b)=>a+b,0) / values.length : 0;
    state.liveSpeedKmh = state.liveSpeedKmh === null || !isFinite(state.liveSpeedKmh) ? raw : (state.liveSpeedKmh * 0.65 + raw * 0.35);
    return Math.max(0, state.liveSpeedKmh);
  }

  function ensureStartEventHasPosition(p){
    if(!state.work || !p) return;
    const ev = (state.work.events || []).find(e => e.type === "Comienzo");
    if(ev && (!isFinite(Number(ev.lat)) || !isFinite(Number(ev.lng)))){
      ev.lat = p.lat;
      ev.lng = p.lng;
      ev.accuracy = p.accuracy || null;
    }
  }

  function appendGpsPointToWork(p, force=false){
    if(!state.work || !p) return null;
    ensureTimeline(state.work);
    const prevClean = state.work.pointsClean.at(-1);
    const cls = force ? "valido" : classifyPoint(p, prevClean);
    state.work.pointsOriginal.push({...p, quality: cls});
    if(isFinite(Number(p.time))) state.work.lastGpsAt = p.time;
    const st = state.work.gpsStats;
    st.best = Math.min(st.best, p.accuracy);
    st.worst = Math.max(st.worst, p.accuracy);
    st.sum += p.accuracy; st.count += 1;
    if(cls === "dudoso") st.doubtful += 1;
    if(cls === "descartado") st.discarded += 1;

    if(cls !== "descartado"){
      if(prevClean){
        const d = haversine(prevClean, p);
        if(force || d >= 1.5){
          if(d >= 1.5) state.work.distanceM += d;
          state.work.pointsClean.push({...p, quality: cls});
        }
      } else {
        state.work.pointsClean.push({...p, quality: cls});
      }
      ensureStartEventHasPosition(p);
    }
    return cls;
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
    const spd = liveSpeedKmhFromPosition(p);
    $("liveSpeed").textContent = spd.toFixed(1).replace(".", ",");

    if(!state.work || state.work.status !== "trabajando") {
      drawCurrentPosition(p);
      return;
    }

    appendGpsPointToWork(p);
    updateRouteLayers();
    updateLiveStats();
    persistActiveWork();
  }

  function drawCurrentPosition(p){
    if(!state.maps.work || !p) return;
    if(state.layers.workCurrent) state.layers.workCurrent.remove();
    state.layers.workCurrent = L.circleMarker([p.lat,p.lng], {
      radius: 8, color:"#fff", weight:3, fillColor:"#376a99", fillOpacity:1
    }).addTo(state.maps.work);
  }

  function windAlertLevel(kmh){
    const v = Number(kmh);
    if(!Number.isFinite(v) || kmh === null || kmh === undefined) return "nodata";
    return v > 9 ? "red" : v > 4.5 ? "amber" : "green";
  }

  function drawWindArrows(map, readings, key="windArrows"){
    if(state.layers[key]){try{state.layers[key].remove();}catch(err){} state.layers[key]=null;}
    if(!map || !window.L) return;
    const group=L.layerGroup().addTo(map);
    (readings || []).filter(r => r?.status === "ok" && isValidRoutePoint(r) && r.directionDeg !== null && r.directionDeg !== undefined && Number.isFinite(Number(r.directionDeg))).forEach(r=>{
      const direction = ((Number(r.directionDeg)+180)%360+360)%360;
      const color={green:"#2e8b4c", amber:"#ba8a19", red:"#b83e35"}[windAlertLevel(r.kmh)]||"#777";
      const html=`<span class="pbgps-wind-arrow" style="color:${color};transform:rotate(${direction}deg)">↑</span>`;
      L.marker([Number(r.lat),Number(r.lng)],{icon:L.divIcon({html,className:"pbgps-wind-pin",iconSize:[30,30],iconAnchor:[15,15]})})
        .bindTooltip(`Viento modelizado ${formatWind(r.kmh)} · dirección desde ${windDirectionText(r.directionDeg)} · ${r.timeLabel || ""}`,{permanent:false})
        .addTo(group);
    });
    state.layers[key]=group;
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
    drawWindArrows(map, state.work?.windReadings || [], "workWindArrows");
  }

  function drawEventMarkers(map){
    if(state.layers.workEvents) state.layers.workEvents.remove();
    state.layers.workEvents = L.layerGroup().addTo(map);
    (state.work?.events || []).forEach(ev => {
      if(!isValidRoutePoint(ev)) return;
      const color = ev.type === "Comienzo" ? "#2f7d44" : ev.type.includes("Fin") ? "#a8483a" : "#c47b32";
      L.circleMarker([ev.lat, ev.lng], { radius:9, color:"#fff", weight:3, fillColor:color, fillOpacity:1 })
        .bindTooltip(ev.label, { permanent:false })
        .addTo(state.layers.workEvents);
    });
    (state.work?.incidents || []).forEach(inc => {
      if(!isValidRoutePoint(inc)) return;
      const color = getIncidentColor(inc.type);
      L.circleMarker([inc.lat, inc.lng], { radius:8, color:"#fff", weight:2, fillColor:color, fillOpacity:1 })
        .bindTooltip(inc.type, { permanent:false })
        .addTo(state.layers.workEvents);
    });
  }

  function addEvent(type, label, notes="", position=null, atMs=Date.now()){
    if(!state.work) return null;
    const p = position || state.currentPos || state.gpsCalibration?.last || null;
    const ev = {
      id: "ev-" + atMs + "-" + Math.random().toString(16).slice(2),
      at: new Date(atMs).toISOString(),
      timeLabel: timeLabelFromMs(atMs),
      type, label, notes,
      lat: isValidRoutePoint(p) ? Number(p.lat) : null,
      lng: isValidRoutePoint(p) ? Number(p.lng) : null,
      accuracy: p?.accuracy != null && Number.isFinite(Number(p.accuracy)) ? Number(p.accuracy) : null
    };
    state.work.events.push(ev);
    state.work.lastEventAt = atMs;
    return ev;
  }

  function openStopModal(){ $("stopModal").classList.remove("hidden"); }
  function closeStopModal(){ $("stopModal").classList.add("hidden"); }

  async function handleStop(reason){
    closeStopModal();
    if(!state.work || state.work.status !== "trabajando") return;

    const now = Date.now();
    const p = await resolveEventPosition();

    if(reason === "Fin de tratamiento de la parcela"){
      if(shouldTrackWindForWork(state.work)) await recordAutomaticWind("fin");
      closeWorkSegment(now, "Fin de tratamiento");
      addEvent("Fin de tratamiento", "Punto final", "Parcela finalizada", p, now);
      state.work.status = "finalizado";
      state.work.finishedAt = now;
      recoverRouteForReport(state.work);
      freezeFinalSnapshot(state.work);
      $("stopWorkBtn").classList.add("hidden");
      $("continueWorkBtn").classList.add("hidden");
      $("beginWorkBtn").classList.add("hidden");
      setWorkStateUi("Finalizado");
      stopGpsWatch();
      updateLiveStats();
      const finalReport = normalizeWorkForReport(serializeWork(state.work), "work");
      state.reportWork = finalReport;
      state.reportOrigin = "work";
      const saved = saveFinishedWork();
      resetReportTabs();
      show("screen-report");
      if(!saved) toast("El trabajo finalizó, pero no se pudo guardar completo en el historial. Se conserva como trabajo activo para recuperación.");
      return;
    }

    state.work.stops = (state.work.stops || 0) + 1;
    if(reason === "Recarga cisterna") state.work.refills = (state.work.refills || 0) + 1;
    const n = reason === "Recarga cisterna" ? state.work.refills : state.work.stops;
    closeWorkSegment(now, reason);
    const ev = addEvent("Parada", `${reason}${reason === "Recarga cisterna" ? " " + n : ""}`, "Punto de continuidad", p, now);
    ensureTimeline(state.work);
    const stop = {
      id: "stop-" + now,
      eventId: ev?.id || null,
      at: now,
      timeLabel: timeLabelFromMs(now),
      reason,
      refillNumber: reason === "Recarga cisterna" ? state.work.refills : null,
      resumedAt: null,
      resumedLabel: null,
      stoppedMs: 0
    };
    state.work.stopLog.push(stop);
    state.work.currentStopId = stop.id;
    state.work.status = "parado";
    state.work.pausedAt = now;

    $("stopWorkBtn").classList.add("hidden");
    $("continueWorkBtn").classList.remove("hidden");
    setWorkStateUi("Parado");
    $("refillCount").textContent = String(state.work.refills);
    updateLiveStats();
    persistActiveWork();
    upsertPendingWorkInHistory();
  }

  async function continueWork(){
    if(!state.work || state.work.status !== "parado") return;
    startGpsWatch();
    const now = Date.now();
    const p = await resolveEventPosition();
    if(state.work.pausedAt) state.work.stoppedMs = (state.work.stoppedMs || 0) + Math.max(0, now - state.work.pausedAt);
    markCurrentStopResumed(now);
    addEvent("Continuar", "Reanudación", "Continúa el trabajo", p, now);
    state.work.status = "trabajando";
    state.work.pausedAt = null;
    openWorkSegment(now);
    $("stopWorkBtn").classList.remove("hidden");
    $("continueWorkBtn").classList.add("hidden");
    setWorkStateUi("Trabajando");
    updateLiveStats();
    persistActiveWork();
    upsertPendingWorkInHistory();
  }

  function updateLiveStats(){
    if(!state.work) return;
    $("distanceKm").textContent = (state.work.distanceM/1000).toFixed(2).replace(".", ",");
    $("refillCount").textContent = String(state.work.refills);
    updateWindUi();
  }

  function tick(){
    const now = Date.now();
    checkExecutionGap(now);
    if(state.work){
      const liveTimeline = workTimeline(state.work, liveClock(state.work, now), {includeOpen:true});
      $("totalTime").textContent = fmtTime(liveTimeline.elapsedMs);
      $("partialTime").textContent = fmtTime(currentSegmentMs(state.work, now, {live:true}));
      checkWindPrompt();
    }
    requestAnimationFrame(() => setTimeout(tick, 1000));
  }

  function saveFinishedWork(){
    if(!state.work) return false;
    ensureTimeline(state.work);
    recoverRouteForReport(state.work);
    if(workIsCompleted(state.work)) freezeFinalSnapshot(state.work);
    state.work.savedAt = new Date().toISOString();
    const finished = normalizeWorkForReport(serializeWork(state.work), "history");
    const ok = saveHistorySnapshotProtected(finished, "trabajo finalizado");
    if(ok) storage.remove(LS.active);
    else if(!storage.set(LS.active, state.work)){
      exportWorkBackup(state.work, "emergencia_trabajo_finalizado_sin_almacenamiento");
      toast("ATENCIÓN: falló el historial y tampoco pudo conservarse el trabajo activo. Se ha solicitado descargar una copia JSON de emergencia. Comprueba que se ha guardado antes de cerrar la app.");
    }
    return ok;
  }

  function serializeWork(w){
    const out = {
      ...w,
      parcelFeature: w.parcelFeature || state.selectedFeature || null
    };
    ensureTimeline(out);
    recoverRouteForReport(out);
    if(workIsCompleted(out)) freezeFinalSnapshot(out);
    return out;
  }

  function downsamplePoints(points=[], max=1600){
    if(!Array.isArray(points) || points.length <= max) return points || [];
    const step = Math.ceil(points.length / max);
    return points.filter((_, i) => i === 0 || i === points.length - 1 || i % step === 0);
  }

  function compactWorkForHistory(w){
    const copy = serializeWork(w);
    return {
      ...copy,
      parcelFeature: null,
      pointsOriginal: downsamplePoints(copy.pointsOriginal || [], 600),
      pointsClean: downsamplePoints(copy.pointsClean || [], 1600),
      incidents: (copy.incidents || []).map(i => ({...i, photo: null})),
      compactedForStorage: true
    };
  }

  function saveHistorySnapshot(work){
    const hist = storage.get(LS.history, []);
    const snap = serializeWork(work);
    const idx = hist.findIndex(w => w.id === snap.id);
    if(idx >= 0) hist[idx] = snap;
    else hist.unshift(snap);
    return storage.set(LS.history, hist);
  }

  function safeFileNamePart(value){
    return String(value || "trabajo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "trabajo";
  }

  function exportWorkBackup(work, reason="backup"){
    try{
      const snap = serializeWork(work);
      const backup = {
        exportedAt: new Date().toISOString(),
        reason,
        version: VERSION,
        warning: "Copia completa previa a guardado compacto. Conservar este archivo si el historial local no puede guardar todos los datos.",
        work: snap
      };
      const name = `PAZO_BAION_BACKUP_${safeFileNamePart(snap.parcel)}_${safeFileNamePart(snap.type)}_${Date.now()}.json`;
      const blob = new Blob([JSON.stringify(backup, null, 2)], {type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      return true;
    }catch(err){
      console.warn("No se pudo generar backup previo a compactación", err);
      return false;
    }
  }

  function authorizeCompactedHistorySave(work, context="trabajo"){
    const ok = confirm(
      "No se pudo guardar el " + context + " completo en el historial local.\n\n" +
      "Para evitar pérdida silenciosa de datos, la app generará ahora una copia de seguridad completa en formato JSON antes de intentar un guardado compacto.\n\n" +
      "El guardado compacto puede reducir puntos GPS y no conservar fotos dentro del historial local.\n\n" +
      "¿Generar backup y continuar?"
    );
    if(!ok) return false;
    const exported = exportWorkBackup(work, "previo_a_guardado_compacto_" + context.replace(/\s+/g, "_"));
    if(!exported){
      return confirm(
        "No se pudo generar la copia de seguridad automática.\n\n" +
        "¿Autorizar igualmente el guardado compacto?"
      );
    }
    return confirm(
      "Se ha solicitado la descarga de la copia de seguridad completa.\n\n" +
      "¿Autorizar ahora el guardado compacto en el historial local?"
    );
  }

  function saveHistorySnapshotProtected(work, context="trabajo"){
    if(saveHistorySnapshot(work)) return true;
    if(!authorizeCompactedHistorySave(work, context)){
      toast("Guardado compacto cancelado. El trabajo no se ha compactado sin autorización.");
      return false;
    }
    const compact = compactWorkForHistory(work);
    const ok = saveHistorySnapshot(compact);
    if(ok) toast("Se guardó una versión compacta en historial local. Conserva el backup descargado como copia completa.");
    else toast("No se pudo guardar ni la versión compacta. Conserva el backup descargado.");
    return ok;
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
        lat: isValidRoutePoint(p) ? p.lat : null,
        lng: isValidRoutePoint(p) ? p.lng : null,
        accuracy: p?.accuracy ?? null,
        gpsMissing: !p,
        photo
      };

      const all = storage.get(LS.incidents, []);
      const belongsToWork = $("incidentModal").dataset.context === "work" && state.work && !workIsCompleted(state.work) && state.work.parcel === inc.parcel;
      if(belongsToWork){
        state.work.incidents = state.work.incidents || [];
        state.work.incidents.push(inc);
        if(!storage.set(LS.active, state.work)){
          state.work.incidents.pop();
          toast("No se pudo guardar la incidencia dentro del trabajo activo. No se ha confirmado su guardado.");
          return;
        }
      }
      if(!storage.set(LS.incidents, [inc, ...all])){
        if(belongsToWork){
          state.work.incidents.pop();
          storage.set(LS.active, state.work);
        }
        toast("No hay espacio o permiso suficiente para guardar la incidencia. No se ha confirmado el registro.");
        return;
      }
      if(belongsToWork) updateRouteLayers();
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

  function clonePlain(obj){
    if(!obj) return obj;
    try{ return JSON.parse(JSON.stringify(obj)); }
    catch(err){ return {...obj}; }
  }

  function isValidRoutePoint(p){
    if(!p || p.lat === null || p.lat === undefined || p.lat === "" || p.lng === null || p.lng === undefined || p.lng === "") return false;
    const lat = Number(p.lat), lng = Number(p.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  }

  function cleanRoutePoints(points){
    return (Array.isArray(points) ? points : [])
      .filter(isValidRoutePoint)
      .map(p => ({...p, lat:Number(p.lat), lng:Number(p.lng), time: toMs(p.time) || p.time || null}));
  }

  function recoverRouteForReport(w){
    if(!w) return [];
    w.pointsClean = cleanRoutePoints(w.pointsClean);
    w.pointsOriginal = cleanRoutePoints(w.pointsOriginal);
    if(w.pointsClean.length > 1) return w.pointsClean;
    const usableOriginal = w.pointsOriginal.filter(p => p.quality !== "descartado");
    if(usableOriginal.length > 1){
      w.pointsClean = downsamplePoints(usableOriginal, 1600);
      w.routeRebuiltFromOriginal = true;
      return w.pointsClean;
    }
    const eventPts = (w.events || []).filter(isValidRoutePoint).map(ev => ({lat:Number(ev.lat), lng:Number(ev.lng), time:eventMs(ev) || null, quality:"evento"}));
    if(eventPts.length > 1){
      w.pointsClean = eventPts;
      w.routeRebuiltFromEvents = true;
      return w.pointsClean;
    }
    return w.pointsClean || [];
  }

  function normalizeWorkForReport(work, origin="work"){
    if(!work) return null;
    const w = clonePlain(work);
    ensureTimeline(w);
    recoverRouteForReport(w);
    const completedByData = workIsCompleted(w) || !!inferFinishedAt(w) || !!w.finalSnapshot?.finishedAt;
    if(completedByData){
      w.finishedAt = toMs(w.finishedAt) || inferFinishedAt(w) || toMs(w.finalSnapshot?.finishedAt) || lastKnownWorkAt(w);
      w.status = "finalizado";
      freezeFinalSnapshot(w);
    }
    w.reportOrigin = origin;
    return w;
  }

  function getReportWork(){
    if(state.reportWork) return normalizeWorkForReport(state.reportWork, state.reportOrigin || "work");
    if(state.work) return normalizeWorkForReport(state.work, "work");
    const first = storage.get(LS.history, [])[0] || null;
    return first ? normalizeWorkForReport(first, "history") : null;
  }

  function resetReportTabs(){
    // Beta v9.4: la pantalla de informe ya no usa pestañas.
    // Se conserva la función para no romper llamadas existentes.
  }

  function openReportForWork(work, origin="work", historyIndex=null){
    state.reportWork = normalizeWorkForReport(work, origin);
    state.reportOrigin = origin;
    state.reportHistoryIndex = historyIndex;
    resetReportTabs();
    show("screen-report");
  }

  function parcelIdentity(feature){
    if(!feature) return "";
    const explicit = feature.id ?? feature.properties?.id ?? feature.properties?.ID;
    return explicit !== undefined && explicit !== null ? String(explicit) : JSON.stringify(feature.geometry?.coordinates || []).slice(0,180);
  }

  function findParcelFeatureByName(name, id=null){
    if(!state.parcelsGeoJSON || !name) return null;
    if(id){
      const precise = state.parcelsGeoJSON.features.find(f => parcelIdentity(f) === String(id));
      if(precise) return precise;
    }
    return state.parcelsGeoJSON.features.find(f => featureName(f) === name) || null;
  }

  function reportTotalMs(w){
    if(!w) return 0;
    const clock = reportClock(w);
    const tl = workTimeline(w, clock, {includeOpen:true});
    if(tl && (tl.startedAt || tl.elapsedMs)) return Math.max(0, tl.elapsedMs);
    if(workIsCompleted(w) && w.finalSnapshot && isFinite(Number(w.finalSnapshot.elapsedMs))){
      return Math.max(0, Number(w.finalSnapshot.elapsedMs));
    }
    const started = toMs(w?.startedAt);
    return started ? Math.max(0, clock - started) : 0;
  }

  function reportEffectiveActiveMs(w){
    return w ? activeElapsedMs(w, reportClock(w), {live:false}) : 0;
  }

  function reportStoppedMs(w){
    return w ? stoppedElapsedMs(w, reportClock(w), {live:false}) : 0;
  }

  function dailyWorkBreakdown(w){
    const daily = new Map();
    const add = (ms, kind, duration=0) => {
      const d=new Date(ms), date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const item = daily.get(date) || {date, activeMs:0, stoppedMs:0, segments:0};
      if(kind === "active") {item.activeMs += duration; item.segments += 1;}
      else item.stoppedMs += duration;
      daily.set(date, item);
    };
    const split=(start,end,kind,excluded=false)=>{
      if(excluded) return;
      let at=toMs(start), finish=toMs(end);
      if(!at || !finish || finish<at) return;
      while(at < finish){
        const d = new Date(at);
        const midnight=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime();
        const close=Math.min(midnight,finish);
        add(at,kind,excluded?0:close-at);
        at=close;
      }
    };
    const tl=workTimeline(w,reportClock(w),{includeOpen:true});
    (tl.segments||[]).forEach(seg=>split(seg.startAt,seg.endAt,"active"));
    (tl.stops||[]).forEach(st=>split(st.at,st.resumedAt,"stopped",!!st.excludedFromStoppedTime));
    return [...daily.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }

  function dateTimeLabelIfAvailable(x){ return x ? dateTimeLabelFromMs(x) : "—"; }

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

  function bindReportFinalActions(w){
    const shareBtn = $("shareFinalReportBtn");
    const printBtn = $("printFinalReportBtn");
    if(shareBtn) shareBtn.onclick = () => shareReportSummary(w);
    if(printBtn) printBtn.onclick = () => exportDocumentPdf(w);
  }

  function renderReport(){
    try{
      const w = getReportWork();
      if(!w){
        if($("reportTitle")) $("reportTitle").textContent = "Informe de trabajo";
        const pendingActions = $("pendingWorkActions");
        if(pendingActions) pendingActions.classList.add("hidden");
        const finalActions = $("reportFinalActions");
        if(finalActions) finalActions.classList.add("hidden");
        $("reportContent").innerHTML = reportEmpty("No hay trabajo para informar.");
        $("reportMap").classList.add("hidden");
        $("reportMapShell").classList.add("hidden");
        return;
      }
      ensureTimeline(w);
      const completed = workIsCompleted(w);
      if($("reportTitle")) $("reportTitle").textContent = completed ? "Informe de trabajo" : "Trabajo pendiente";
      $("reportSubtitle").textContent = completed ? `${w.parcel} · ${w.type}` : `${w.parcel} · ${w.type} · pendiente de terminar`;
      $("reportStatusChip").textContent = completed ? "Informe definitivo" : "";
      $("reportStatusChip").classList.toggle("hidden", !completed);
      $("reportStatusChip").style.background = completed ? "#eaf6e9" : "#fff4e6";
      $("reportStatusChip").style.color = completed ? "#2f7d44" : "#8b520e";
      const pendingActions = $("pendingWorkActions");
      if(pendingActions) pendingActions.classList.toggle("hidden", completed);
      const finalActions = $("reportFinalActions");
      if(finalActions) finalActions.classList.remove("hidden");
      $("printFinalReportBtn").textContent = completed ? "Generar / guardar PDF" : "PDF provisional";
      bindReportFinalActions(w);
      $("reportTotal").textContent = fmtTime(reportTotalMs(w));
      $("reportDistance").textContent = ((w.distanceM || 0)/1000).toFixed(2).replace(".", ",") + " km";
      $("reportRefills").textContent = String(w.refills || 0);
      const ws = windStats(w.windReadings || []);
      $("reportWind").textContent = shouldTrackWindForWork(w) ? (ws.latestReading ? formatWindReading(ws.latestReading) : "Pendiente") : "No aplica";

      renderReportSummary(w);
      const recoveredRoute = recoverRouteForReport(w);
      const hasMapData = recoveredRoute.length > 1 || (w.events || []).some(e=>isValidRoutePoint(e)) || (w.incidents || []).some(i=>isValidRoutePoint(i)) || (w.windReadings || []).some(r=>r.status === "ok" && isValidRoutePoint(r));
      $("reportMapShell").classList.toggle("hidden", !hasMapData);
      $("reportMapShell").classList.remove("is-expanded");
      $("collapseReportMap").classList.add("hidden");
      $("expandReportMap").classList.remove("hidden");
      if(hasMapData){
        $("reportMap").classList.remove("hidden");
        waitForMapContainer("reportMap", () => renderReportMap(w));
      } else $("reportMap").classList.add("hidden");
    }catch(err){
      console.error("Error al generar resumen", err);
      $("reportContent").innerHTML = reportEmpty("No se pudo abrir el resumen. El trabajo queda guardado localmente para recuperarlo desde el historial.");
      $("reportMap").classList.add("hidden");
    }
  }

  function clearReportMapContainer(){
    const el = $("reportMap");
    if(state.maps.report){
      try{ state.maps.report.off(); state.maps.report.remove(); }
      catch(err){ console.warn("No se pudo destruir el mapa de informe", err); }
      state.maps.report = null;
    }
    ["reportImportedIncidents"].forEach(k => {
      if(state.layers[k]){ try{ state.layers[k].remove(); }catch(err){} state.layers[k] = null; }
    });
    if(el){
      el.innerHTML = "";
      try{ delete el._leaflet_id; }catch(err){ el._leaflet_id = null; }
    }
    return el;
  }

  function renderReportMap(w){
    const el = clearReportMapContainer();
    if(!el) return;
    el.classList.remove("hidden");
    if(!ensureLeaflet()){
      el.classList.add("hidden");
      return;
    }
    const routePoints = recoverRouteForReport(w);
    try{
      const map = L.map(el, { zoomControl:false, attributionControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, boxZoom:false, keyboard:false, tap:false, preferCanvas:true });
      state.maps.report = map;
      const tile = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom:20, keepBuffer:4 });
      tile.addTo(map);
      map._pbgpsTile = tile;

      const reportFeature = w.parcelFeature || findParcelFeatureByName(w.parcel,w.parcelId) || (w.parcel === state.selectedParcelName ? state.selectedFeature : null);
      let bounds = null;
      if(reportFeature) {
        const lyr = L.geoJSON(reportFeature, { style: parcelStyle(true) }).addTo(map).bringToFront();
        bounds = lyr.getBounds();
      }
      drawImportedIncidents(map, "reportImportedIncidents");

      const pts = routePoints.map(p => [Number(p.lat), Number(p.lng)]).filter(a => isFinite(a[0]) && isFinite(a[1]));
      if(pts.length > 1) {
        const route = L.polyline(pts, {color:"#1f7ed0",weight:4,opacity:.95}).addTo(map);
        const rb = route.getBounds();
        bounds = bounds && bounds.isValid() ? bounds.extend(rb) : rb;
      }
      (w.events || []).forEach(ev => {
        if(isValidRoutePoint(ev)) L.circleMarker([Number(ev.lat),Number(ev.lng)], {radius:6,color:"#fff",weight:2,fillColor:String(ev.type||"").includes("Fin")?"#a8483a":ev.type==="Comienzo"?"#2f7d44":"#c47b32",fillOpacity:1}).addTo(map);
      });
      (w.incidents || []).forEach(inc => {
        if(isValidRoutePoint(inc)) L.circleMarker([Number(inc.lat),Number(inc.lng)], {radius:6,color:"#fff",weight:2,fillColor:getIncidentColor(inc.type),fillOpacity:1}).addTo(map);
      });
      if(shouldTrackWindForWork(w)) drawWindArrows(map,w.windReadings || [],"reportWindArrows");
      if(bounds && bounds.isValid()) stabilizeMap(map, bounds, [18,18]);
      else stabilizeMap(map, null, [18,18]);
    }catch(err){
      console.error("Error al pintar mapa de informe", err);
      clearReportMapContainer();
      el.classList.add("hidden");
      const msg = document.createElement("div");
      msg.className = "report-warning";
      msg.innerHTML = "<strong>Mapa no disponible:</strong> no se pudo reconstruir la visualización del recorrido, pero el trabajo sigue guardado.";
      $("reportContent").prepend(msg);
    }
  }

  function reportWarning(w){
    const gps = w.gpsStats || {};
    const routePoints = recoverRouteForReport(w);
    let out = "";
    if((w.distanceM || 0) > 20 && routePoints.length < 2){
      out += `<div class="report-warning"><strong>Ruta no disponible:</strong> hay distancia registrada, pero no hay puntos GPS suficientes para dibujar el recorrido.</div>`;
    } else if(w.routeRebuiltFromOriginal){
      out += `<div class="report-warning"><strong>Ruta reconstruida:</strong> el recorrido se recuperó desde puntos GPS originales porque la ruta depurada no estaba disponible.</div>`;
    }
    if(workIsCompleted(w) && (w.forcedStart || gps.discarded > 0 || (gps.worst && gps.worst > 20))){
      out += `<div class="report-warning"><strong>Advertencia GPS:</strong> el trazado debe interpretarse como aproximado en algunos tramos. Se conservaron los puntos originales y se generó una ruta depurada para visualización e informe.</div>`;
    }
    return out;
  }

  function renderReportSummary(w){
    ensureTimeline(w);
    const day = w.day || {};
    const ws = windStats(w.windReadings || []);
    const completed = workIsCompleted(w);
    const status = completed ? "Finalizado" : "Pendiente de terminar";
    const avg = reportAverageSpeed(w);
    const started = dateTimeLabelFromMs(w.startedAt);
    const finished = w.finishedAt ? dateTimeLabelFromMs(w.finishedAt) : "—";
    const clock = reportClock(w);
    const tl = workTimeline(w, clock, {includeOpen:true});
    const segments = tl.segments.length ? tl.segments : (w.segments || []);
    const stops = tl.stops.length ? tl.stops : (w.stopLog || []);
    const gps = w.gpsStats || {};
    const cal = w.gpsCalibration || {};
    const avgAcc = gps.count ? (gps.sum / gps.count) : null;
    const observations = (day.notes || w.notes || "").trim ? String(day.notes || w.notes || "").trim() : "";

    const segmentRows = segments.map((seg, i) => {
      const end = seg.endAt ? dateTimeLabelIfAvailable(seg.endAt) : (w.status === "trabajando" ? "en curso" : "—");
      const ms = Math.max(0, Number(seg.activeMs) || 0);
      const reason = seg.closeReason ? ` · cierre: ${escapeHtml(seg.closeReason)}` : "";
      return `<div><span>Tramo ${i+1}: ${escapeHtml(dateTimeLabelIfAvailable(seg.startAt))} → ${escapeHtml(end)}${reason}</span><strong>${fmtTime(ms)}</strong></div>`;
    }).join("");

    const stopRows = stops.map((stop, i) => {
      const duration = stop.excludedFromStoppedTime ? "No computa" : (stop.resumedAt ? fmtTime(stop.stoppedMs || 0) : (w.status === "parado" ? fmtTime(Math.max(0, clock - (toMs(stop.at) || clock))) : "—"));
      const resume = stop.resumedAt ? ` · continúa ${escapeHtml(dateTimeLabelIfAvailable(stop.resumedAt))}` : "";
      return `<div><span>Parada ${i+1}: ${escapeHtml(dateTimeLabelIfAvailable(stop.at))} · ${escapeHtml(stop.reason || "—")}${resume}</span><strong>${duration}</strong></div>`;
    }).join("");

    const eventRows = (w.events || []).map(ev => `<div class="report-event"><strong>${escapeHtml(ev.type || "Evento")}</strong><span>${escapeHtml(ev.timeLabel || timeLabelHMS(eventMs(ev)))} · ${escapeHtml(ev.label || "—")}</span><small>GPS ${formatMeters(ev.accuracy)}${ev.notes ? " · " + escapeHtml(ev.notes) : ""}</small></div>`).join("");

    const incidentRows = (w.incidents || []).map(i => `<div class="report-event"><strong>${escapeHtml(i.type || "Incidencia")}</strong><span>${escapeHtml(i.timeLabel || "—")} · ${escapeHtml(i.status || "—")}</span><small>GPS ${formatMeters(i.accuracy)}${i.gpsMissing ? " · Sin coordenada" : ""}${i.notes ? " · " + escapeHtml(i.notes) : ""}</small>${i.photo ? `<img class="incident-thumb" src="${i.photo}" alt="Foto incidencia" />` : ""}</div>`).join("");

    const windRows = (w.windReadings || []).map(r => {
      if(r.status === "error"){
        return `<div class="report-event"><strong>Sin dato automático</strong><span>${escapeHtml(r.timeLabel || "—")}</span><small>${escapeHtml(r.error || "No se pudo consultar la fuente meteorológica.")} · Fuente: ${escapeHtml(r.source || WIND_SOURCE_NAME)}</small></div>`;
      }
      return `<div class="report-event"><strong>${escapeHtml(formatWindReading(r))}</strong><span>${escapeHtml(r.timeLabel || "—")}${r.weatherTime ? " · dato " + escapeHtml(r.weatherTime) : ""}</span><small>Automático cada 30 min · Fuente: ${escapeHtml(r.source || WIND_SOURCE_NAME)} · Ubicación: ${escapeHtml(r.coordinateSource || "—")}</small></div>`;
    }).join("");

    const windBlock = shouldTrackWindForWork(w)
      ? `<div class="report-section-title">Viento durante la aplicación</div>
         ${ws.max !== null && ws.max > 4.5 ? `<div class="report-warning"><strong>Alerta de viento (${windAlertLevel(ws.max) === "red" ? "roja" : "ámbar"}):</strong> máximo modelizado ${formatWind(ws.max)}. Comprobar condiciones locales y las instrucciones del producto.</div>` : ""}
         ${ws.failed ? `<div class="report-warning"><strong>Intervalos sin dato:</strong> ${ws.failed} consulta(s) automática(s) no pudieron obtener viento por falta de conexión, coordenadas o respuesta válida.</div>` : ""}
         <div class="report-grid">
           ${reportKpi("Último", ws.latestReading ? formatWindReading(ws.latestReading) : "—")}
           ${reportKpi("Media", ws.avg === null ? "—" : formatWind(ws.avg))}
           ${reportKpi("Máximo", ws.max === null ? "—" : formatWind(ws.max))}
           ${reportKpi("Registros válidos", String(ws.count))}
           ${reportKpi("Fuente", WIND_SOURCE_NAME)}
           ${reportKpi("Modo", "Automático cada 30 min")}
         </div><p class="report-sub">Código orientativo: verde hasta 4,5 km/h, ámbar más de 4,5 hasta 9 km/h, rojo por encima de 9 km/h. Fuente meteorológica modelizada, no medición directa.</p>
         <div class="report-section-title">Registros automáticos de viento</div>
         <div class="report-list">${windRows || reportEmpty("Sin registros automáticos todavía. La app consultará el viento al iniciar y después cada 30 minutos mientras el tratamiento fitosanitario esté activo.")}</div>`
      : `<div class="report-section-title">Viento</div>${reportEmpty("No aplicable: el viento solo se registra en trabajos de aplicación de fitosanitarios.")}`;

    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual report-visual-complete">
        ${completed ? reportWarning(w) : ""}

        <div class="report-section-title">Datos del trabajo</div>
        <div class="report-grid">
          ${reportKpi("Parcela", w.parcel || "—")}
          ${reportKpi("Labor", w.type || "—")}
          ${reportKpi("Estado", status)}
          ${reportKpi("Fecha", dateLabelDMY(reportDateSource(w)))}
          ${reportKpi("Inicio", started)}
          ${reportKpi("Fin", finished)}
        </div>

        <div class="report-section-title">Jornada</div>
        <div class="report-list">
          <div><span>Operario</span><strong>${escapeHtml(day.operator || "—")}</strong></div>
          <div><span>Tractor</span><strong>${escapeHtml(day.tractor || "—")}</strong></div>
          <div><span>Atomizador / cisterna</span><strong>${escapeHtml(day.sprayer || "—")}</strong></div>
          <div><span>Observaciones de jornada</span><strong>${escapeHtml(observations || "Sin observaciones registradas.")}</strong></div>
        </div>

        <div class="report-section-title">Tiempos y recorrido</div>
        <div class="report-grid">
          ${reportKpi("Tiempo activo", fmtTime(reportEffectiveActiveMs(w)))}
          ${reportKpi("Tiempo parado", fmtTime(reportStoppedMs(w)))}
          ${reportKpi("Tiempo total/transcurrido", fmtTime(reportTotalMs(w)))}
          ${reportKpi("Distancia", ((w.distanceM || 0)/1000).toFixed(2).replace(".", ",") + " km")}
          ${reportKpi("Recargas", String(w.refills || 0))}
          ${reportKpi("Paradas", String(stops.filter(st=>!st.excludedFromStoppedTime).length || w.stops || 0))}
          ${reportKpi("Incidencias", String((w.incidents || []).length))}
          ${reportKpi("Velocidad GPS media", avg === null ? "—" : avg.toFixed(1).replace(".", ",") + " km/h")}
        </div>

        <div class="report-section-title">Desglose por día</div>
        <div class="report-list">${dailyWorkBreakdown(w).map(d=>`<div><span>${escapeHtml(dateLabelDMY(d.date))} · ${d.segments} tramos</span><strong>${fmtTime(d.activeMs)} activos · ${fmtTime(d.stoppedMs)} parados</strong></div>`).join("") || reportEmpty("Sin tramos de trabajo registrados.")}</div>
        ${w.suspensionDetected ? `<p class="report-sub">Se detectaron interrupciones del navegador. Los intervalos sin GPS no se suman al tiempo efectivo.</p>` : ""}

        <div class="report-section-title">Tramos de trabajo</div>
        <div class="report-list">${segmentRows || reportEmpty("Sin tramos registrados todavía.")}</div>

        <div class="report-section-title">Paradas registradas</div>
        <div class="report-list">${stopRows || reportEmpty("Sin paradas intermedias registradas.")}</div>

        <div class="report-section-title">GPS y ruta</div>
        <div class="report-grid">
          ${reportKpi("Ruta GPS disponible", routeAvailable(w) ? "Sí" : "No")}
          ${reportKpi("Precisión media GPS", averageGpsAccuracyText(w))}
          ${reportKpi("Calibración", cal.quality || "—")}
          ${reportKpi("Mejor previa", formatMeters(cal.best))}
          ${reportKpi("Media previa", formatMeters(cal.avg))}
          ${reportKpi("Peor trabajo", formatMeters(gps.worst))}
          ${reportKpi("Puntos originales", String((w.pointsOriginal || []).length))}
          ${reportKpi("Ruta depurada", String((w.pointsClean || []).length))}
          ${reportKpi("Dudosos", String(gps.doubtful || 0))}
          ${reportKpi("Descartados", String(gps.discarded || 0))}
        </div>

        ${windBlock}

        <div class="report-section-title">Eventos relevantes</div>
        <div class="report-list">${eventRows || reportEmpty("Sin eventos registrados todavía.")}</div>

        <div class="report-section-title">Incidencias</div>
        <div class="report-list">${incidentRows || reportEmpty("Sin incidencias registradas.")}</div>
      </div>`;
  }

  function renderReportWork(w){
    ensureTimeline(w);
    const avg = reportAverageSpeed(w);
    const started = dateTimeLabelFromMs(w.startedAt);
    const finished = w.finishedAt ? dateTimeLabelFromMs(w.finishedAt) : "—";
    const clock = reportClock(w);
    const tl = workTimeline(w, clock, {includeOpen:true});
    const segments = tl.segments.length ? tl.segments : (w.segments || []);
    const stops = tl.stops.length ? tl.stops : (w.stopLog || []);
    const segmentRows = segments.map((seg, i) => {
      const end = seg.endAt ? dateTimeLabelIfAvailable(seg.endAt) : (w.status === "trabajando" ? "en curso" : "—");
      const ms = Math.max(0, Number(seg.activeMs) || 0);
      const reason = seg.closeReason ? ` · cierre: ${escapeHtml(seg.closeReason)}` : "";
      return `<div><span>Tramo ${i+1}: ${escapeHtml(dateTimeLabelIfAvailable(seg.startAt))} → ${escapeHtml(end)}${reason}</span><strong>${fmtTime(ms)}</strong></div>`;
    }).join("");
    const stopRows = stops.map((stop, i) => {
      const duration = stop.excludedFromStoppedTime ? "No computa" : (stop.resumedAt ? fmtTime(stop.stoppedMs || 0) : (w.status === "parado" ? fmtTime(Math.max(0, clock - (toMs(stop.at) || clock))) : "—"));
      const resume = stop.resumedAt ? ` · continúa ${escapeHtml(dateTimeLabelIfAvailable(stop.resumedAt))}` : "";
      return `<div><span>Parada ${i+1}: ${escapeHtml(dateTimeLabelIfAvailable(stop.at))} · ${escapeHtml(stop.reason || "—")}${resume}</span><strong>${duration}</strong></div>`;
    }).join("");
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        ${!workIsCompleted(w) ? `<div class="report-warning"><strong>Trabajo no finalizado:</strong> para un informe definitivo pulsa Parada → Fin de tratamiento. Este resumen no suma tiempo posterior al último registro guardado.</div>` : ""}
        <div class="report-section-title">Tiempos y recorrido</div>
        <div class="report-grid">
          ${reportKpi("Tiempo activo", fmtTime(reportEffectiveActiveMs(w)))}
          ${reportKpi("Tiempo transcurrido", fmtTime(reportTotalMs(w)))}
          ${reportKpi("Tiempo parado", fmtTime(reportStoppedMs(w)))}
          ${reportKpi("Velocidad GPS media", avg === null ? "—" : avg.toFixed(1).replace(".", ",") + " km/h")}
          ${reportKpi("Distancia", ((w.distanceM || 0)/1000).toFixed(2).replace(".", ",") + " km")}
          ${reportKpi("Paradas", String(stops.filter(st=>!st.excludedFromStoppedTime).length || w.stops || 0))}
          ${reportKpi("Recargas", String(w.refills || 0))}
          ${reportKpi("Incidencias", String((w.incidents || []).length))}
        </div>
        <div class="report-section-title">Inicio y fin</div>
        <div class="report-list">
          <div><span>Hora de inicio</span><strong>${escapeHtml(started)}</strong></div>
          <div><span>Hora de fin</span><strong>${escapeHtml(finished)}</strong></div>
        </div>
        <div class="report-section-title">Tramos de trabajo entre paradas</div>
        <div class="report-list">${segmentRows || reportEmpty("Sin tramos registrados todavía.")}</div>
        <div class="report-section-title">Paradas registradas</div>
        <div class="report-list">${stopRows || reportEmpty("Sin paradas intermedias registradas.")}</div>
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
        ${workIsCompleted(w) ? reportWarning(w) : ""}
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
    if(!shouldTrackWindForWork(w)){
      $("reportContent").innerHTML = `
        <div class="scroll-box report-visual">
          <div class="report-section-title">Viento</div>
          ${reportEmpty("No aplicable: el viento solo se registra en trabajos de aplicación de fitosanitarios.")}
        </div>`;
      return;
    }
    const readings = w.windReadings || [];
    const ws = windStats(readings);
    const validRows = readings.map(r => {
      if(r.status === "error"){
        return `<div class="report-event"><strong>Sin dato automático</strong><span>${escapeHtml(r.timeLabel || "—")}</span><small>${escapeHtml(r.error || "No se pudo consultar la fuente meteorológica.")} · Fuente: ${escapeHtml(r.source || WIND_SOURCE_NAME)}</small></div>`;
      }
      return `<div class="report-event"><strong>${escapeHtml(formatWindReading(r))}</strong><span>${escapeHtml(r.timeLabel || "—")}${r.weatherTime ? " · dato " + escapeHtml(r.weatherTime) : ""}</span><small>Automático cada 30 min · Fuente: ${escapeHtml(r.source || WIND_SOURCE_NAME)} · Ubicación: ${escapeHtml(r.coordinateSource || "—")}</small></div>`;
    }).join("");
    const warning = ws.max !== null && ws.max >= 20 ? `<div class="report-warning"><strong>Aviso viento:</strong> se registró un valor máximo de ${formatWind(ws.max)}. Revisar idoneidad de aplicación según criterio técnico y normativa aplicable.</div>` : "";
    const failed = ws.failed ? `<div class="report-warning"><strong>Intervalos sin dato:</strong> ${ws.failed} consulta(s) automática(s) no pudieron obtener viento por falta de conexión, coordenadas o respuesta válida.</div>` : "";
    $("reportContent").innerHTML = `
      <div class="scroll-box report-visual">
        ${warning}
        ${failed}
        <div class="report-section-title">Viento durante la aplicación</div>
        <div class="report-grid">
          ${reportKpi("Último", ws.latestReading ? formatWindReading(ws.latestReading) : "—")}
          ${reportKpi("Media", ws.avg === null ? "—" : formatWind(ws.avg))}
          ${reportKpi("Máximo", ws.max === null ? "—" : formatWind(ws.max))}
          ${reportKpi("Registros válidos", String(ws.count))}
          ${reportKpi("Fuente", WIND_SOURCE_NAME)}
          ${reportKpi("Modo", "Automático cada 30 min")}
        </div>
        <div class="report-section-title">Registros automáticos</div>
        ${validRows || reportEmpty("Sin registros automáticos todavía. La app consultará el viento al iniciar y después cada 30 minutos mientras el tratamiento fitosanitario esté activo.")}
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
    $("printReport").onclick = () => printReportPdf(w);
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
    const header = "hora,fecha_iso,velocidad_kmh,direccion_grados,direccion_texto,racha_kmh,fuente,estado,ubicacion,error\n";
    const rows = (w.windReadings || []).map(r => [
      r.timeLabel,
      r.at,
      r.kmh,
      r.directionDeg,
      r.directionText || windDirectionText(r.directionDeg),
      r.gustKmh,
      r.source || WIND_SOURCE_NAME,
      r.status || "ok",
      r.coordinateSource || "",
      r.error || ""
    ].map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
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

  function pad2(n){
    return String(n).padStart(2,"0");
  }

  function dateLabelDMY(value){
    const ms = toMs(value);
    if(!ms) return "—";
    const d = new Date(ms);
    if(isNaN(d.getTime())) return "—";
    return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
  }

  function timeLabelHMS(value){
    const ms = toMs(value);
    if(!ms) return "—";
    const d = new Date(ms);
    if(isNaN(d.getTime())) return "—";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function reportDateSource(w){
    return toMs(w?.startedAt) || toMs(w?.finishedAt) || toMs(w?.finalSnapshot?.startedAt) || toMs(w?.createdAt) || lastKnownWorkAt(w);
  }

  function eventByName(w, part){
    const needle = String(part || "").toLowerCase();
    return (w?.events || []).find(ev => String(ev.type || "").toLowerCase().includes(needle)) || null;
  }

  function routeAvailable(w){
    return recoverRouteForReport(w).length > 1;
  }

  function averageGpsAccuracyText(w){
    const gps = w?.gpsStats || {};
    const avg = gps.count ? (gps.sum / gps.count) : null;
    return avg === null || !isFinite(avg) ? "no consta" : formatMeters(avg);
  }

  function gpsWarningsTextList(w){
    const gps = w?.gpsStats || {};
    const out = [];
    if((w?.distanceM || 0) > 20 && recoverRouteForReport(w).length < 2) out.push("distancia registrada sin puntos GPS suficientes para dibujar recorrido");
    if(w?.routeRebuiltFromOriginal) out.push("ruta reconstruida desde puntos GPS originales");
    if(w?.routeRebuiltFromEvents) out.push("ruta reconstruida desde eventos GPS");
    if(w?.forcedStart) out.push("inicio forzado con precisión GPS insuficiente o sin calibración completa");
    if((gps.discarded || 0) > 0) out.push(`${gps.discarded} puntos GPS descartados`);
    if(gps.worst && gps.worst > 15) out.push(`precisión GPS peor registrada ${formatMeters(gps.worst)}`);
    return out;
  }

  function shareWindText(w){
    if(!shouldTrackWindForWork(w)) return "- No aplicable: trabajo no fitosanitario";
    const readings = w?.windReadings || [];
    if(!readings.length) return "- Sin datos automáticos disponibles";
    const ws = windStats(readings);
    if(!ws.latestReading){
      const failed = ws.failed ? ` (${ws.failed} consulta(s) automática(s) sin dato)` : "";
      return `- Sin datos automáticos válidos${failed}`;
    }
    const lines = [
      `- Registros automáticos válidos: ${ws.count}`,
      `- Último registro: ${formatWindReading(ws.latestReading)}${ws.latestReading?.timeLabel ? ` (${ws.latestReading.timeLabel})` : ""}`,
      `- Fuente: ${ws.latestReading.source || WIND_SOURCE_NAME}`
    ];
    if(ws.failed) lines.push(`- Consultas sin dato: ${ws.failed}`);
    return lines.join("\n");
  }

  function buildShareSummaryText(w){
    const work = normalizeWorkForReport(w, state.reportOrigin || "work") || w || {};
    const beginEvent = eventByName(work, "comienzo");
    const endEvent = eventByName(work, "fin");
    const startMs = toMs(work.startedAt) || eventMs(beginEvent) || toMs(work.finalSnapshot?.startedAt);
    const endMs = toMs(work.finishedAt) || eventMs(endEvent) || toMs(work.finalSnapshot?.finishedAt);
    const stopCount = (work.stopLog || []).length || work.stops || 0;
    const gpsWarnings = gpsWarningsTextList(work);
    const observations = (work.day && work.day.notes) ? String(work.day.notes).trim() : "";
    const lines = [
      "PAZO BAION GPS - RESUMEN DE TRABAJO",
      "",
      `Estado: ${workIsCompleted(work) ? "Informe definitivo" : "Resumen provisional"}`,
      `Parcela: ${work.parcel || "—"}`,
      `Trabajo: ${work.type || "—"}`,
      `Fecha: ${dateLabelDMY(reportDateSource(work))}`,
      "",
      "TIEMPOS",
      `- Inicio: ${timeLabelHMS(startMs)}`,
      `- Fin: ${timeLabelHMS(endMs)}`,
      `- Tiempo activo: ${fmtTime(reportEffectiveActiveMs(work))}`,
      `- Tiempo parado: ${fmtTime(reportStoppedMs(work))}`,
      `- Tiempo total/transcurrido: ${fmtTime(reportTotalMs(work))}`,
      "",
      "RECORRIDO Y TRABAJO",
      `- Distancia: ${((work.distanceM || 0)/1000).toFixed(2).replace(".", ",")} km`,
      `- Recargas: ${work.refills || 0}`,
      `- Incidencias: ${(work.incidents || []).length}`,
      `- Paradas: ${stopCount}`,
      "",
      "GPS Y RUTA",
      `- Ruta GPS disponible: ${routeAvailable(work) ? "sí" : "no"}`,
      `- Precisión media GPS: ${averageGpsAccuracyText(work)}`,
      ...(gpsWarnings.length ? [`- Advertencias GPS: ${gpsWarnings.join("; ")}`] : []),
      "",
      "VIENTO",
      shareWindText(work),
      "",
      "EVENTOS RELEVANTES",
      `- Comienzo del trabajo: ${timeLabelHMS(eventMs(beginEvent) || startMs)}`,
      `- Fin del trabajo: ${timeLabelHMS(eventMs(endEvent) || endMs)}`,
      "",
      "OBSERVACIONES",
      `- ${observations || "Sin observaciones registradas."}`,
      "",
      "Generado localmente desde Pazo Baión GPS."
    ];
    return lines.join("\n");
  }

  function featureCoordinatePairs(feature){
    const out = [];
    const walk = (coords) => {
      if(!Array.isArray(coords)) return;
      if(coords.length >= 2 && isFinite(Number(coords[0])) && isFinite(Number(coords[1]))){
        out.push({lng:Number(coords[0]), lat:Number(coords[1])});
      } else coords.forEach(walk);
    };
    walk(feature?.geometry?.coordinates);
    return out;
  }

  function routeSvgForPrint(w){
    const route = recoverRouteForReport(w).filter(isValidRoutePoint);
    const parcelPts = featureCoordinatePairs(w?.parcelFeature || findParcelFeatureByName(w?.parcel));
    const all = [...route, ...parcelPts];
    if(all.length < 2) return "";
    const minLat = Math.min(...all.map(p=>Number(p.lat)));
    const maxLat = Math.max(...all.map(p=>Number(p.lat)));
    const minLng = Math.min(...all.map(p=>Number(p.lng)));
    const maxLng = Math.max(...all.map(p=>Number(p.lng)));
    const wBox = 640, hBox = 300, pad = 24;
    const dx = maxLng - minLng || 0.000001;
    const dy = maxLat - minLat || 0.000001;
    const project = (p) => {
      const x = pad + ((Number(p.lng)-minLng)/dx) * (wBox - pad*2);
      const y = pad + ((maxLat-Number(p.lat))/dy) * (hBox - pad*2);
      return [x,y];
    };
    const routeLine = route.length > 1 ? route.map(p=>project(p).map(n=>n.toFixed(1)).join(",")).join(" ") : "";
    const parcelLine = parcelPts.length > 2 ? parcelPts.map(p=>project(p).map(n=>n.toFixed(1)).join(",")).join(" ") : "";
    const start = route[0] ? project(route[0]) : null;
    const end = route[route.length-1] ? project(route[route.length-1]) : null;
    return `
      <div class="print-map-box">
        <div class="print-map-title">Ruta / mapa esquemático del trabajo</div>
        <svg viewBox="0 0 ${wBox} ${hBox}" role="img" aria-label="Ruta GPS del trabajo">
          <rect x="0" y="0" width="${wBox}" height="${hBox}" rx="18" fill="#f7f3e9"/>
          ${parcelLine ? `<polyline points="${parcelLine}" fill="none" stroke="#d2bb7a" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
          ${routeLine ? `<polyline points="${routeLine}" fill="none" stroke="#1f7ed0" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
          ${start ? `<circle cx="${start[0].toFixed(1)}" cy="${start[1].toFixed(1)}" r="7" fill="#2f7d44" stroke="#fff" stroke-width="3"/>` : ""}
          ${end ? `<circle cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="7" fill="#a8483a" stroke="#fff" stroke-width="3"/>` : ""}
        </svg>
        <div class="print-map-legend"><span>Verde: comienzo</span><span>Rojo: fin</span><span>Azul: recorrido GPS</span><span>Oro: parcela</span></div>
      </div>`;
  }

  function reportRowsHtml(items){
    return items.map(([k,v]) => `<div class="row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("");
  }

  function printableReportHtml(w){
    const work = normalizeWorkForReport(w, state.reportOrigin || "work") || w || {};
    const beginEvent = eventByName(work, "comienzo");
    const endEvent = eventByName(work, "fin");
    const startMs = toMs(work.startedAt) || eventMs(beginEvent) || toMs(work.finalSnapshot?.startedAt);
    const endMs = toMs(work.finishedAt) || eventMs(endEvent) || toMs(work.finalSnapshot?.finishedAt);
    const ws = windStats(work.windReadings || []);
    const stopCount = (work.stopLog || []).length || work.stops || 0;
    const gpsWarnings = gpsWarningsTextList(work);
    const routeSvg = routeSvgForPrint(work);
    const events = (work.events || []).map(ev => `<tr><td>${escapeHtml(ev.timeLabel || timeLabelHMS(eventMs(ev)))}</td><td>${escapeHtml(ev.type || "—")}</td><td>${escapeHtml(ev.label || "—")}</td><td>${escapeHtml(formatMeters(ev.accuracy))}</td><td>${escapeHtml(ev.notes || "")}</td></tr>`).join("");
    const incidents = (work.incidents || []).map(inc => `<tr><td>${escapeHtml(inc.timeLabel || "—")}</td><td>${escapeHtml(inc.type || "—")}</td><td>${escapeHtml(inc.status || "—")}</td><td>${escapeHtml(formatMeters(inc.accuracy))}</td><td>${escapeHtml(inc.notes || "")}</td></tr>`).join("");
    const windRows = (work.windReadings || []).map(r => {
      if(r.status === "error") return `<tr><td>${escapeHtml(r.timeLabel || "—")}</td><td>Sin dato</td><td>—</td><td>—</td><td>${escapeHtml(r.source || WIND_SOURCE_NAME)}</td><td>${escapeHtml(r.error || "Error de consulta automática")}</td></tr>`;
      return `<tr><td>${escapeHtml(r.timeLabel || "—")}</td><td>${escapeHtml(formatWind(r.kmh))}</td><td>${escapeHtml(windDirectionText(r.directionDeg))}</td><td>${escapeHtml(isFinite(Number(r.gustKmh)) ? formatWind(r.gustKmh) : "—")}</td><td>${escapeHtml(r.source || WIND_SOURCE_NAME)}</td><td>${escapeHtml(r.coordinateSource || "—")}</td></tr>`;
    }).join("");
    const windSection = shouldTrackWindForWork(work)
      ? `<h2>Viento</h2><div class="grid">${reportRowsHtml([["Último", ws.latestReading ? formatWindReading(ws.latestReading) : "—"],["Media", ws.avg === null ? "—" : formatWind(ws.avg)],["Máximo", ws.max === null ? "—" : formatWind(ws.max)],["Registros válidos", String(ws.count)],["Fuente", WIND_SOURCE_NAME],["Modo", "Automático cada 30 min"]])}</div>${windRows ? `<table><thead><tr><th>Hora</th><th>Velocidad</th><th>Dirección</th><th>Racha</th><th>Fuente</th><th>Ubicación/error</th></tr></thead><tbody>${windRows}</tbody></table>` : `<div class="warn">Sin datos automáticos disponibles.</div>`}`
      : `<h2>Viento</h2><div class="warn">No aplicable: el viento solo se registra en tratamientos fitosanitarios.</div>`;
    const observations = (work.day && work.day.notes) ? String(work.day.notes).trim() : "Sin observaciones registradas.";
    const routeWarning = (work.distanceM || 0) > 20 && recoverRouteForReport(work).length < 2 ? "Ruta no disponible: distancia registrada sin puntos GPS suficientes." : "";
    const avgSpeed = reportAverageSpeed(work);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe Pazo Baión GPS</title>
      <style>
        @page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#f8f3e8;color:#173f2b;font-family:Georgia,'Times New Roman',serif;font-size:12.5px;line-height:1.35}.page{max-width:820px;margin:0 auto;background:#fffdf7;border:1px solid #d9c998;border-radius:18px;padding:22px}.top{border-bottom:2px solid #d9c998;padding-bottom:12px;margin-bottom:16px}h1{margin:0;color:#103f2a;font-size:28px;letter-spacing:.02em}h2{margin:18px 0 8px;color:#103f2a;font-size:18px;border-bottom:1px solid #e3d7b8;padding-bottom:5px}.sub{font-family:Arial,sans-serif;color:#6d6a5d;font-size:13px;margin-top:4px}.chip{display:inline-block;margin-top:10px;border:1px solid #a8cdb1;background:#edf7ed;color:#2f7d44;border-radius:999px;padding:5px 12px;font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px}.row{border:1px solid #e1d4ad;border-radius:10px;padding:8px 10px;background:#fffef9;display:flex;justify-content:space-between;gap:12px}.row span{font-family:Arial,sans-serif;color:#6d6a5d}.row strong{text-align:right;color:#103f2a}.warn{border:1px solid #e1c27a;background:#fff6dd;color:#7a520b;border-radius:12px;padding:10px 12px;margin:10px 0;font-family:Arial,sans-serif}.print-map-box{border:1px solid #d9c998;border-radius:14px;padding:10px;background:#fffaf0}.print-map-title{font-weight:bold;margin-bottom:7px}.print-map-legend{display:flex;gap:14px;flex-wrap:wrap;font-family:Arial,sans-serif;font-size:10px;color:#6d6a5d;margin-top:6px}table{width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:11px;background:#fffef9}th,td{border:1px solid #e1d4ad;padding:6px;text-align:left;vertical-align:top}th{background:#f5efd9;color:#103f2a}.footer{margin-top:20px;border-top:1px solid #e3d7b8;padding-top:10px;font-family:Arial,sans-serif;color:#6d6a5d;font-size:11px}@media print{body{background:white}.page{border:0;padding:0}.no-print{display:none!important}}
      </style></head><body><main class="page">
        <section class="top"><h1>${workIsCompleted(work) ? "PAZO BAION GPS - INFORME DE TRABAJO" : "PAZO BAION GPS - TRABAJO PENDIENTE"}</h1><div class="sub">Generado localmente desde este dispositivo · ${escapeHtml(new Date().toLocaleString('es-ES'))}</div><div class="chip">${workIsCompleted(work) ? "Informe definitivo" : "Trabajo pendiente · sin finalizar"}</div></section>
        ${gpsWarnings.length ? `<div class="warn"><strong>Advertencias GPS:</strong> ${escapeHtml(gpsWarnings.join("; "))}</div>` : ""}
        ${routeWarning ? `<div class="warn"><strong>${escapeHtml(routeWarning)}</strong></div>` : ""}
        <h2>Cabecera</h2><div class="grid">${reportRowsHtml([["Parcela", work.parcel || "—"],["Trabajo", work.type || "—"],["Fecha", dateLabelDMY(reportDateSource(work))],["Estado", workIsCompleted(work) ? "Finalizado" : "Pendiente de terminar"],["Inicio", timeLabelHMS(startMs)],["Fin", timeLabelHMS(endMs)]])}</div>
        <h2>Tiempos y recorrido</h2><div class="grid">${reportRowsHtml([["Tiempo activo", fmtTime(reportEffectiveActiveMs(work))],["Tiempo parado", fmtTime(reportStoppedMs(work))],["Tiempo total/transcurrido", fmtTime(reportTotalMs(work))],["Distancia", ((work.distanceM || 0)/1000).toFixed(2).replace(".", ",") + " km"],["Recargas", String(work.refills || 0)],["Paradas", String(stopCount)],["Incidencias", String((work.incidents || []).length)],["Velocidad GPS media", avgSpeed === null ? "—" : avgSpeed.toFixed(1).replace(".", ",") + " km/h"]])}</div>
        <h2>GPS y ruta</h2><div class="grid">${reportRowsHtml([["Ruta GPS disponible", routeAvailable(work) ? "Sí" : "No"],["Precisión media GPS", averageGpsAccuracyText(work)],["Puntos originales", String((work.pointsOriginal || []).length)],["Ruta depurada", String((work.pointsClean || []).length)]])}</div>${routeSvg || ""}
        ${windSection}
        <h2>Eventos</h2>${events ? `<table><thead><tr><th>Hora</th><th>Tipo</th><th>Punto</th><th>GPS</th><th>Observación</th></tr></thead><tbody>${events}</tbody></table>` : `<div class="warn">Sin eventos registrados.</div>`}
        <h2>Incidencias</h2>${incidents ? `<table><thead><tr><th>Hora</th><th>Tipo</th><th>Estado</th><th>GPS</th><th>Observación</th></tr></thead><tbody>${incidents}</tbody></table>` : `<div class="warn">Sin incidencias registradas.</div>`}
        <h2>Observaciones</h2><div class="row"><span>Observaciones</span><strong>${escapeHtml(observations)}</strong></div>
        <div class="footer">Pazo Baión GPS · ${escapeHtml(VERSION)}</div>
      </main></body></html>`;
  }

  async function shareFinalReport(w){
    try{
      const work = normalizeWorkForReport(w, state.reportOrigin || "work") || w || {};
      const html = printableReportHtml(work);
      const filename = safeFilename(work, "informe_pazo_baion", "html");
      const title = workIsCompleted(work) ? "Informe Pazo Baion GPS" : "Trabajo pendiente Pazo Baion GPS";
      const text = buildShareSummaryText(work);
      if(window.File && navigator.canShare){
        const file = new File([html], filename, {type:"text/html"});
        if(navigator.canShare({files:[file]})){
          try{
            await navigator.share({title, text:"Informe estructurado generado localmente desde Pazo Baión GPS.", files:[file]});
            return;
          }catch(err){
            if(err && err.name === "AbortError") return;
          }
        }
      }
      if(navigator.share){
        try{ await navigator.share({title, text}); return; }
        catch(err){ if(err && err.name === "AbortError") return; }
      }
      downloadBlob(filename, html, "text/html");
      toast("Informe generado como archivo HTML para guardar o enviar.");
    }catch(err){
      console.error("No se pudo compartir el informe final", err);
      toast("No se pudo generar el informe para compartir o guardar.");
    }
  }

  function exportDocumentPdf(w){
    if(!window.PAZO_BAION_PDF){
      toast("El generador de PDF no está disponible. Revisa que pdf-v95.js esté junto a la aplicación.");
      return;
    }
    try{
      const work = normalizeWorkForReport(w, "pdf");
      const blob = window.PAZO_BAION_PDF.createDocument({
        work,
        completed:workIsCompleted(work),
        activeMs:reportEffectiveActiveMs(work),
        stoppedMs:reportStoppedMs(work),
        elapsedMs:reportTotalMs(work),
        daily:dailyWorkBreakdown(work),
        gpsAverage:averageGpsAccuracyText(work),
        windStats:windStats(work.windReadings||[]),
        isPhytosanitary:shouldTrackWindForWork(work)
      });
      const name=safeFilename(work,"informe_documental","pdf");
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download=name;a.style.display="none";
      document.body.appendChild(a);a.click();
      setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},5000);
    }catch(err){
      console.error("Fallo creando PDF",err);
      toast("No se pudo generar el PDF: "+(err.message || "error no especificado"));
    }
  }

  function printReportPdf(w){
    try{
      const html = printableReportHtml(w);
      const win = window.open("", "_blank");
      if(!win){
        downloadBlob(safeFilename(w, "informe_imprimible", "html"), html, "text/html");
        toast("No se pudo abrir la vista de impresión. Se descargó un informe HTML imprimible.");
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      setTimeout(() => {
        try{ win.focus(); win.print(); }
        catch(err){ console.warn("No se pudo lanzar impresión", err); }
      }, 500);
    }catch(err){
      console.error("No se pudo generar informe imprimible", err);
      toast("No se pudo generar el informe imprimible del trabajo.");
    }
  }

  async function shareReportSummary(w){
    const text = buildShareSummaryText(w);
    if(navigator.share){
      try{ await navigator.share({ title:"Resumen Pazo Baion GPS", text }); return; } catch(err){}
    }
    try{ await navigator.clipboard.writeText(text); toast("Resumen copiado al portapapeles."); }
    catch{ toast(text); }
  }


  function workIsCompleted(w){
    return Boolean(
      w?.finishedAt ||
      w?.status === "finalizado" ||
      w?.status === "completado" ||
      w?.finalSnapshot?.finishedAt ||
      (Array.isArray(w?.events) && w.events.some(ev => String(ev.type || "").toLowerCase().includes("fin")))
    );
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
    ensureTimeline(state.work);
    const snap = serializeWork({...state.work, status:"pendiente"});
    return saveHistorySnapshotProtected(snap, "trabajo pendiente");
  }

  function recoverActiveWorkToHistory(){
    const active = storage.get(LS.active, null);
    if(!active || !active.id) return;
    ensureTimeline(active);
    if(!workIsCompleted(active) && active.status === "trabajando"){
      // Al arrancar después de cerrar Safari, nunca se inventan horas de GPS en segundo plano.
      const interruptionAt = Math.max(toMs(active.startedAt) || 0, lastKnownWorkAt(active) || Date.now());
      closeInterruptedWork(active, interruptionAt, "Reapertura tras interrupción del navegador");
    }
    const existing = storage.get(LS.history, []).find(w => w.id === active.id);
    if(existing && workIsCompleted(existing)){
      storage.remove(LS.active);
      return;
    }
    const snap = serializeWork({...active, status:workIsCompleted(active) ? "finalizado" : "pendiente"});
    if(saveHistorySnapshotProtected(snap, workIsCompleted(active) ? "trabajo finalizado recuperado" : "trabajo pendiente recuperado")){
      storage.remove(LS.active);
    } else {
      toast("Existe un trabajo recuperable pendiente de asegurar en el historial. No se ha borrado del almacenamiento activo.");
    }
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
      <div class="history-card history-card-v12">
        <button class="history-main-button" data-history-index="${originalIndex}" aria-label="Abrir ficha de trabajo">
          <span class="history-date">${escapeHtml(workHistoryDate(w))}</span>
          <strong>${escapeHtml(w.parcel || "Parcela sin nombre")}</strong>
          <span class="history-type">${escapeHtml(w.type || "Trabajo sin tipo")}</span>
          <span class="history-status ${cls}">${status}</span>
        </button>
        <button class="history-delete-button" data-history-delete="${originalIndex}" aria-label="Eliminar esta ficha">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M8 7l1 12h6l1-12"/></svg>
        </button>
      </div>`;
    }).join("") : `<div class="history-empty">${filter === "pending" ? "No hay trabajos pendientes." : filter === "completed" ? "No hay trabajos completados." : "No hay trabajos guardados."}</div>`;

    qsa("[data-history-index]").forEach(card => {
      card.addEventListener("click", () => {
        const latest = storage.get(LS.history, []);
        const w = latest[Number(card.dataset.historyIndex)];
        if(w) openReportForWork(w, "history", Number(card.dataset.historyIndex));
      });
    });
    qsa("[data-history-delete]").forEach(btn => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        deleteHistoryItem(Number(btn.dataset.historyDelete));
      });
    });
  }

  function deleteHistoryItem(index){
    const hist = storage.get(LS.history, []);
    const item = hist[index];
    if(!item){ renderHistory(); return; }
    const label = `${workHistoryDate(item)} · ${item.parcel || "Parcela sin nombre"} · ${item.type || "Trabajo sin tipo"}`;
    if(!confirm("¿Eliminar solo esta ficha de trabajo?\n\n" + label)) return;
    const text = prompt("Para confirmar el borrado individual, escribe ELIMINAR:");
    if(text !== "ELIMINAR") { toast("Borrado cancelado."); return; }
    hist.splice(index, 1);
    if(storage.set(LS.history, hist)) renderHistory();
    else toast("No se pudo eliminar la ficha del historial local.");
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
    recoverActiveWorkToHistory();
  }

  function goAfterMapReady(){
    if(!isValidParcelsGeoJSON(state.parcelsGeoJSON)){
      toast("No hay capa de parcelas válida cargada en este dispositivo.");
      return;
    }
    const day = storage.get(LS.day, null);
    if(day && day.date === todayIso()){
      state.dayConfig = day;
      state.parcelSelectReturnTo = "screen-map-load";
      show("screen-parcel-select");
      return;
    }
    if(day && day.date && day.date !== todayIso()){
      offerPreviousDayConfig(day);
      return;
    }
    loadSavedDayConfig();
    show("screen-day-config");
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
        e.target.value = "";
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
        e.target.value = "";
      }catch(err){
        $("incidentLayerStatus").className = "status-card bad";
        $("incidentLayerStatus").textContent = "INCIDENCIAS_.geojson no válido: " + err.message;
      }
    });

    $("continueAfterMap").onclick = goAfterMapReady;
    $("openHistoryFromMap").onclick = () => {
      state.historyReturnTo = "screen-map-load";
      upsertPendingWorkInHistory();
      show("screen-history");
    };
    $("backFromHistory").onclick = () => show(state.historyReturnTo || "screen-map-load");
    $("backFromParcelSelect").onclick = () => show(state.parcelSelectReturnTo || "screen-map-load");
    $("previousDayHelp").onclick = () => {
      $("previousDayModal").classList.add("hidden");
      $("previousDayHelpModal").classList.remove("hidden");
    };
    $("backFromPreviousDayHelp").onclick = () => {
      $("previousDayHelpModal").classList.add("hidden");
      $("previousDayModal").classList.remove("hidden");
    };
    $("reusePreviousDay").onclick = usePreviousDayConfig;
    $("modifyPreviousDay").onclick = modifyPreviousDayConfig;
    $("closePreviousDay").onclick = closePreviousDayDialog;
    $("openPrivacy").onclick = () => $("privacyModal").classList.remove("hidden");
    $("closePrivacy").onclick = () => $("privacyModal").classList.add("hidden");
    $("saveLayerSet").onclick = saveNamedLayerSet;
    $("loadLayerSet").onclick = loadNamedLayerSet;
    $("deleteLayerSet").onclick = deleteNamedLayerSet;
    $("layerSetName").addEventListener("input", setLayerSetInfo);
    $("savedSetsDetails").addEventListener("toggle", () => { if($("savedSetsDetails").open) refreshLayerSets(); });

    $("saveDayConfig").onclick = saveDayConfig;
    $("backFromDayConfig").onclick = () => {
      const cameFromPending = !!state.pendingResumeAfterDay;
      state.pendingResumeAfterDay = null;
      show(cameFromPending ? "screen-report" : "screen-map-load");
    };
    $("expandReportMap").onclick = () => {
      $("reportMapShell").classList.add("is-expanded");
      $("expandReportMap").classList.add("hidden");
      $("collapseReportMap").classList.remove("hidden");
      afterLayoutStable(()=>state.maps.report?.invalidateSize());
    };
    $("collapseReportMap").onclick = () => {
      $("reportMapShell").classList.remove("is-expanded");
      $("collapseReportMap").classList.add("hidden");
      $("expandReportMap").classList.remove("hidden");
      afterLayoutStable(()=>state.maps.report?.invalidateSize());
    };
    $("reportBackBtn").onclick = () => {
      if(state.reportOrigin === "history") show("screen-history");
      else show("screen-work");
    };
    if($("resumePendingWorkBtn")) $("resumePendingWorkBtn").onclick = resumePendingWorkFromReport;
    if($("finishPendingWorkBtn")) $("finishPendingWorkBtn").onclick = finishPendingWorkFromReport;
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
    $("viewDraftReportBtn").onclick = () => { state.reportWork = null; state.reportOrigin = "work"; state.reportHistoryIndex = null; resetReportTabs(); show("screen-report"); };
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
    $("windReadingBtn").onclick = () => recordAutomaticWind("actualizacion_usuario", {notify:true});

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
    document.addEventListener("visibilitychange", () => {
      if(document.hidden) suspendCurrentWork("Interrupción del navegador");
      else { state.lastHeartbeatAt = Date.now(); if(state.work) updateLiveStats(); }
    });
    window.addEventListener("pagehide", () => suspendCurrentWork("Interrupción del navegador"));
    initLists();
    loadSavedDayConfig();
    bind();
    restoreIfPossible();

    setTimeout(async () => {
      await initSavedLayerSets();
      show("screen-map-load");
    }, 4000);
  }

  window.addEventListener("load", init);
})();