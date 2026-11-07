/* PAZO BAION GPS · Beta v9.7. Archivo local de trabajos y numeración por campaña.
   No transmite datos a servidores. No elimina ni modifica el historial v08. */
(() => {
  'use strict';
  const DB_NAME = 'pazo_baion_trabajos_v97';
  const clone = obj => JSON.parse(JSON.stringify(obj));
  function open(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB) return reject(new Error('IndexedDB no disponible'));
      const r=indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=()=>{
        const db=r.result;
        if(!db.objectStoreNames.contains('works')) db.createObjectStore('works',{keyPath:'id'});
        if(!db.objectStoreNames.contains('counters')) db.createObjectStore('counters',{keyPath:'campaign'});
      };
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error||new Error('No se puede abrir el archivo'));
      r.onblocked=()=>reject(new Error('Almacenamiento ocupado en otra pestaña'));
    });
  }
  async function transact(storeName,mode,fn){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let answer,req;
      try {
        const tx=db.transaction(storeName,mode);
        const store=tx.objectStore(storeName);
        req=fn(store);
        if(req){req.onsuccess=()=>answer=req.result;}
        tx.oncomplete=()=>{db.close();resolve(answer);};
        tx.onerror=()=>{db.close();reject(tx.error||req?.error||new Error('Error al guardar'))};
        tx.onabort=()=>{db.close();reject(tx.error||new Error('Operación abortada'))};
      } catch(err){db.close();reject(err);}
    });
  }
  const getWorks=()=>transact('works','readonly',s=>s.getAll());
  const putWork=work=>transact('works','readwrite',s=>s.put(clone(work)));
  const deleteWork=id=>transact('works','readwrite',s=>s.delete(id));
  const clearWorks=()=>transact('works','readwrite',s=>s.clear());
  // Reserva transaccional: el número no se reutiliza tras borrar la ficha.
  async function nextNumber(campaign, knownMax=0){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('counters','readwrite');
      const store=tx.objectStore('counters');
      let allocated=null;
      const get=store.get(String(campaign));
      get.onsuccess=()=>{
        allocated=Math.max(Number(get.result?.last)||0,Number(knownMax)||0)+1;
        store.put({campaign:String(campaign),last:allocated});
      };
      tx.oncomplete=()=>{db.close();resolve(allocated);};
      tx.onerror=()=>{db.close();reject(tx.error||new Error('No se pudo reservar el número'));};
      tx.onabort=()=>{db.close();reject(tx.error||new Error('Numeración cancelada'));};
    });
  }
  const getCounters=()=>transact('counters','readonly',s=>s.getAll());
  async function ensureMinimumNumber(campaign,number){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('counters','readwrite');
      const store=tx.objectStore('counters'), key=String(campaign);
      let finalNumber=Number(number)||0;
      const get=store.get(key);
      get.onsuccess=()=>{finalNumber=Math.max(finalNumber,Number(get.result?.last)||0);store.put({campaign:key,last:finalNumber});};
      tx.oncomplete=()=>{db.close();resolve(finalNumber)};
      tx.onerror=()=>{db.close();reject(tx.error||new Error('No se pudieron restaurar los contadores'))};
      tx.onabort=()=>{db.close();reject(tx.error||new Error('Restauración interrumpida'))};
    });
  }
  async function importWorks(works){
    if(!Array.isArray(works)) throw new Error('Formato de trabajos inválido');
    let count=0;
    for(const w of works){
      if(w && typeof w.id==='string' && w.id.length<250){await putWork(w);count++;}
    }
    return count;
  }
  window.PAZO_BAION_ARCHIVE={getWorks,putWork,deleteWork,clearWorks,nextNumber,getCounters,ensureMinimumNumber,importWorks};
})();
