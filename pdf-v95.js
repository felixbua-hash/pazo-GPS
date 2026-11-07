/* PAZO BAION GPS v9.7 — generador PDF documental local, sin servidores ni librerías externas.
 * PDF multipágina A4 con datos, cronología, incidencias, viento, ruta vectorial y desglose diario.
 * La cartografía satelital no se incrusta; el croquis vectorial se marca expresamente como esquemático.
 */
(() => {
  'use strict';
  const PW = 595.28, PH = 841.89, M = 43;
  const GREEN = [0.09,0.24,0.16], GOLD=[0.64,0.53,0.29], MUTED=[0.37,0.38,0.33], LIGHT=[0.95,0.94,0.90];
  const col = a => a.map(x=>Number(x).toFixed(3)).join(' ');
  const f2 = n => Number(n).toFixed(2);
  const winAnsi = t => String(t ?? '—')
    .replace(/[\u2013\u2014]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201C\u201D]/g,'"')
    .replace(/\u2192/g,'->').replace(/\u2022/g,'·').replace(/\u2713/g,'Sí')
    .replace(/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF]/g, c => {
      const s=c.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      return /^[\u0020-\u007E\u00A0-\u00FF]$/.test(s) ? s : '?';
    });
  const quote = v => '(' + winAnsi(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]/g,' ') + ')';
  const dt = x => {
    if(!x) return '—';
    const d = new Date(x);
    return Number.isFinite(d.getTime()) ? d.toLocaleString('es-ES') : String(x);
  };
  const clock = ms => {
    const n = Math.max(0, Number(ms)||0);
    const t=Math.floor(n/1000);
    return `${String(Math.floor(t/3600)).padStart(2,'0')}:${String(Math.floor((t%3600)/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  };
  const number = n => Number.isFinite(Number(n)) ? Number(n).toFixed(2).replace('.',',') : '—';
  const valid = p => p && p.lat!=null && p.lng!=null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) &&
    Math.abs(Number(p.lat))<=90 && Math.abs(Number(p.lng))<=180 && !(Number(p.lat)===0 && Number(p.lng)===0);
  const paraWrap = (s, maxChars) => {
    const words=winAnsi(s).replace(/\s+/g,' ').split(' ');
    const out=[]; let current='';
    for(let word of words){
      while(word.length>maxChars){
        if(current){out.push(current); current='';}
        out.push(word.slice(0,maxChars)); word=word.slice(maxChars);
      }
      if((current+' '+word).trim().length>maxChars && current){out.push(current);current=word;}
      else current=(current+' '+word).trim();
    }
    if(current)out.push(current);
    return out.length ? out : ['—'];
  };
  const escapeHtmlNotNeeded = a => a;

  function createDocument(payload){
    const work = payload.work || {};
    const pages=[];
    let y=96, ops=[];
    const T=(x,top,text,size=10,bold=false,color=GREEN)=>{
      const yy=PH-top;
      ops.push(`${col(color)} rg BT /${bold?'FB':'FR'} ${f2(size)} Tf 1 0 0 1 ${f2(x)} ${f2(yy)} Tm ${quote(text)} Tj ET`);
    };
    const rule=(x1,t1,x2,t2,color=GOLD,width=1)=>ops.push(`${col(color)} RG ${f2(width)} w ${f2(x1)} ${f2(PH-t1)} m ${f2(x2)} ${f2(PH-t2)} l S`);
    const rect=(x,top,w,h,fill=LIGHT)=>ops.push(`${col(fill)} rg ${f2(x)} ${f2(PH-top-h)} ${f2(w)} ${f2(h)} re f`);
    function page(){
      if(ops.length) pages.push(ops);
      ops=[]; y=98;
      rect(0,0,PW,61,LIGHT);
      T(M,29,'PAZO BAION GPS',18,true,GREEN);
      T(M,46,'INFORME DOCUMENTAL · BETA v9.7',8,false,MUTED);
      rule(M,64,PW-M,64);
    }
    function needed(height){if(y+height>PH-65)page();}
    function section(title){needed(44);y+=13;T(M,y,title,13,true);y+=10;rule(M,y+4,PW-M,y+4);y+=22;}
    function row(label,value){
      const lines=paraWrap(String(value ?? '—'),61);
      needed(14*lines.length+6);
      T(M,y,String(label)+':',10,true);
      lines.forEach((line,i)=>T(188,y+i*14,line,10,false,MUTED));
      y+=Math.max(18,lines.length*14+3);
    }
    function textParagraph(message){
      const lines=paraWrap(message,94);
      needed(13*lines.length+11);
      lines.forEach((line,i)=>T(M,y+i*13,line,9,false,MUTED));
      y+=lines.length*13+11;
    }
    function listItem(label,desc){
      const lines=paraWrap(String(desc??'—'),93);
      needed(lines.length*13+20);
      T(M,y,label,9,true,GREEN);
      y+=14;
      lines.forEach((line,i)=>T(M+9,y+i*13,line,9,false,MUTED));
      y+=lines.length*13+7;
    }
    function routeDrawing(){
      const parts=(Array.isArray(work.routeSections)&&work.routeSections.length?work.routeSections:[work.pointsClean||[]])
        .map(arr=>(arr||[]).filter(valid));
      const features=(Array.isArray(work.parcelFeatures)?work.parcelFeatures:[]).filter(Boolean);
      if(work.parcelFeature && !features.includes(work.parcelFeature))features.push(work.parcelFeature);
      const rings=[];
      for(const feature of features){
        const geom=feature?.geometry;
        if(!geom)continue;
        const multi=geom.type==='Polygon'?[geom.coordinates]:geom.type==='MultiPolygon'?geom.coordinates:[];
        for(const poly of multi)for(const ring of (poly||[])){
          const pts=ring.filter(p=>Array.isArray(p)&&Number.isFinite(Number(p[0]))&&Number.isFinite(Number(p[1])))
            .map(([lng,lat])=>({lng:Number(lng),lat:Number(lat)}));
          if(pts.length>=3)rings.push(pts);
        }
      }
      if(!parts.some(a=>a.length>=2)&&!rings.length){
        textParagraph('No hay datos geográficos suficientes para dibujar la parcela o el recorrido.');return;
      }
      needed(281);
      const bx=M+8,by=y+13,bw=PW-M*2-16,bh=205;
      rect(M,y,PW-M*2,252,LIGHT);
      T(bx+5,by+12,'Croquis GPS vectorial: perímetro de parcelas (verde) y recorridos (azul)',8,false,MUTED);
      const parcelPts=rings.flat();
      let all=parcelPts.length?parcelPts:parts.flat();
      const lats=all.map(p=>p.lat),lons=all.map(p=>p.lng);
      let loX=Math.min(...lons),hiX=Math.max(...lons),loY=Math.min(...lats),hiY=Math.max(...lats);
      // Proyección local de lat/lon para que el dibujo no deforme tanto las proporciones.
      const cosLat=Math.max(.2,Math.cos(((loY+hiY)/2)*Math.PI/180));
      let dx=Math.max(1e-7,(hiX-loX)*cosLat),dy=Math.max(1e-7,hiY-loY);
      let spanX=dx*1.13,spanY=dy*1.13;
      const factor=Math.min((bw-28)/spanX,(bh-51)/spanY);
      const left=bx+14+((bw-28)-spanX*factor)/2;
      const bottom=by+bh-13-((bh-51)-spanY*factor)/2;
      const mapx=lng=>left+((Number(lng)-loX)*cosLat+(spanX-dx)/2)*factor;
      const mapy=lat=>bottom-((Number(lat)-loY)+(spanY-dy)/2)*factor;
      const drawLine=(pts,rgb,width,closed=false)=>{
        if(pts.length<2)return;
        let commands=`${col(rgb)} RG ${f2(width)} w `;
        pts.forEach((p,i)=>{commands+=`${f2(mapx(p.lng))} ${f2(PH-mapy(p.lat))} ${i?'l':'m'} `;});
        if(closed)commands+='h ';
        ops.push(commands+'S');
      };
      // Clip to the plot box; bad GPS coordinates must never draw over the PDF text.
      ops.push(`q ${f2(bx+7)} ${f2(PH-by-bh+20)} ${f2(bw-14)} ${f2(bh-45)} re W n`);
      rings.forEach(ring=>drawLine(ring,[.12,.38,.23],2.8,true));
      for(const arr of parts){
        const onMap=parcelPts.length ? arr.filter(p=>p.lng>=loX-0.01&&p.lng<=hiX+0.01&&p.lat>=loY-0.01&&p.lat<=hiY+0.01):arr;
        drawLine(onMap,[.13,.47,.78],1.9,false);
      }
      for(const arr of parts){
        if(!arr.length)continue;
        for(const [p,fill] of [[arr[0],[.2,.55,.27]],[arr.at(-1),[.66,.22,.16]]]){
          const x=mapx(p.lng),t=mapy(p.lat);
          if(x<bx+6||x>bx+bw-6||t<by+25||t>by+bh-20)continue;
          ops.push(`${col(fill)} rg ${f2(x-3.3)} ${f2(PH-t-3.3)} 6.6 6.6 re f`);
        }
      }
      ops.push('Q');
      const pCount=parts.reduce((v,p)=>v+p.length,0);
      T(bx+6,by+bh+10,`${rings.length?'Perímetros históricos incluidos':'Sin perímetro de parcela'} · ${pCount} puntos en ${parts.length} recorridos`,8,false,MUTED);
      y+=265;
    }

    page();
    T(M,y,'RESUMEN DEL TRABAJO',15,true);y+=25;
    row('Estado',payload.completed?'Informe definitivo':'Trabajo pendiente (no definitivo)');
    if(work.campaign&&work.treatmentNumber){
      row('Campaña',String(work.campaign));
      row('Número de tratamiento',String(work.treatmentNumber));
      row('Identificador',work.treatmentId||'—');
    }
    row('Parcela',work.parcel || '—');
    row('Labor',work.type || '—');
    row('Fecha de inicio',dt(work.startedAt));
    row('Fecha de fin',dt(work.finishedAt));
    if(work.isTreatmentGroup&&Array.isArray(work.partWorks)){
      section('PARCELAS Y JORNADAS DEL TRATAMIENTO');
      for(const part of work.partWorks)row(part.parcel||'Parcela',`${dt(part.startedAt)} · ${part.finishedAt?'Finalizado':'Pendiente'} · ${number((Number(part.distanceM)||0)/1000)} km · ${(part.pointsClean||[]).length} puntos`);
    }
    section('JORNADA');
    row('Operario',work.day?.operator || '—');
    row('Tractor',work.day?.tractor || '—');
    row('Atomizador / cisterna',work.day?.sprayer || '—');
    if(work.day?.notes)row('Observaciones',work.day.notes);
    section('TIEMPOS Y TRABAJO');
    row('Tiempo activo',clock(payload.activeMs));
    row('Tiempo parado',clock(payload.stoppedMs));
    row('Tiempo total transcurrido',clock(payload.elapsedMs));
    row('Distancia',`${number((Number(work.distanceM)||0)/1000)} km`);
    row('Recargas',work.refills || 0);
    row('Paradas',work.stops || 0);
    row('Incidencias',(work.incidents || []).length);
    if(payload.daily?.length){
      section('DESGLOSE POR DÍA');
      for(const d of payload.daily)row(d.date,`activo ${clock(d.activeMs)} · parado ${clock(d.stoppedMs)} · tramos ${d.segments}`);
    }
    section('GPS Y RUTA');
    row('Precisión media',payload.gpsAverage || '—');
    row('Calibración',work.gpsCalibration?.quality || '—');
    row('Puntos originales',(work.pointsOriginal || []).length);
    row('Ruta depurada',(work.pointsClean || []).length);
    if(work.suspensionDetected)textParagraph('Se detectó al menos una interrupción del seguimiento. Los intervalos sin GPS no se han añadido al tiempo activo.');
    if(!(work.parcelFeature||(work.parcelFeatures||[]).length))textParagraph('Aviso: no se conserva el contorno original de la parcela en esta ficha.');
    const avgActive=Number(payload.activeMs)||0;
    const speed=avgActive>0?Number(work.distanceM||0)/(avgActive/3600000)/1000:0;
    if(speed>35)textParagraph(`Alerta de coherencia GPS: distancia y tiempo equivalen a ${number(speed)} km/h de media, probablemente datos anómalos. No se han alterado los originales.`);
    const avAcc=Number(work.gpsStats?.count)>0?Number(work.gpsStats?.sum)/Number(work.gpsStats?.count):null;
    if(avAcc>20)textParagraph(`Alerta de precisión GPS: media aproximada de ${Math.round(avAcc)} metros; croquis orientativo.`);
    routeDrawing();
    section('VIENTO');
    if(payload.isPhytosanitary){
      row('Fuente','Open-Meteo (modelo meteorológico, no medición directa)');
      row('Consultas válidas',payload.windStats?.count || 0);
      row('Consultas fallidas',payload.windStats?.failed || 0);
      row('Viento medio',payload.windStats?.avg==null?'—':`${number(payload.windStats.avg)} km/h`);
      row('Viento máximo',payload.windStats?.max==null?'—':`${number(payload.windStats.max)} km/h`);
      textParagraph('Alertas orientativas: verde hasta 4,5 km/h; ámbar más de 4,5 hasta 9 km/h; rojo por encima de 9 km/h. Consultar condiciones locales y ficha del producto.');
      for(const r of (work.windReadings||[])){
        listItem(dt(r.at),r.status==='error' ? `Sin dato: ${r.error||'Consulta fallida'}` : `${number(r.kmh)} km/h · dirección ${r.directionDeg??'—'}° · racha ${r.gustKmh??'—'} km/h`);
      }
    }else textParagraph('No aplicable a esta labor.');
    section('EVENTOS RELEVANTES');
    if(!(work.events||[]).length)textParagraph('Sin eventos registrados.');
    for(const ev of (work.events||[]))listItem(`${dt(ev.at)} · ${ev.type||'Evento'}`,`${ev.label||'—'} · ${ev.notes||''} · GPS: ${valid(ev)?'disponible':'sin coordenada'}`);
    section('INCIDENCIAS');
    if(!(work.incidents||[]).length)textParagraph('Sin incidencias registradas.');
    for(const inc of (work.incidents||[]))listItem(`${dt(inc.at)} · ${inc.type||'Incidencia'}`,`Estado: ${inc.status||'—'} · GPS: ${valid(inc)?'disponible':'sin coordenada'} · Foto: ${inc.photo?'sí, conservada en registro local':'no'} · ${inc.notes||''}`);
    if((work.incidents||[]).some(x=>x.photo))textParagraph('Las fotos de incidencias no van incrustadas en este PDF. Conservar el registro original o la copia JSON para disponer de las imágenes.');
    section('OBSERVACIONES DE FIABILIDAD');
    textParagraph('Este informe se genera localmente. Los recorridos y estadísticas dependen de la precisión GPS, el estado del dispositivo y la disponibilidad de red. El mapa representado es esquemático, no una ortofoto; incluye los límites disponibles y los recorridos separados.');
    pages.push(ops);
    // Añadir numeración y pie independiente a todas las páginas.
    pages.forEach((page,index)=>{
      page.push(`${col(GOLD)} RG 0.75 w ${f2(M)} 55 m ${f2(PW-M)} 55 l S`);
      page.push(`${col(MUTED)} rg BT /FR 8 Tf 1 0 0 1 ${f2(M)} 40 Tm ${quote('Pazo Baion GPS · Beta v9.7 · Documento generado localmente')} Tj ET`);
      page.push(`${col(MUTED)} rg BT /FR 8 Tf 1 0 0 1 ${f2(PW-M-40)} 40 Tm ${quote(`${index+1} / ${pages.length}`)} Tj ET`);
    });
    const objects=[];
    const add=(src)=>{objects.push(src);return objects.length;};
    const catalog=add(''),pagesRef=add('');
    const regular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const bold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const refs=[];
    pages.forEach(cmds=>{
      const stream=cmds.join('\n')+'\n';
      const content=add(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
      const pageRef=add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents ${content} 0 R /Resources << /Font << /FR ${regular} 0 R /FB ${bold} 0 R >> >> >>`);
      refs.push(pageRef);
    });
    objects[catalog-1]=`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`;
    objects[pagesRef-1]=`<< /Type /Pages /Count ${refs.length} /Kids [${refs.map(n=>`${n} 0 R`).join(' ')}] >>`;
    let pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets=[0];
    for(let i=0;i<objects.length;i++){
      offsets.push(pdf.length);
      pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref=pdf.length;
    pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
    for(let i=1;i<offsets.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
    pdf+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes=new Uint8Array(pdf.length);
    for(let i=0;i<pdf.length;i++)bytes[i]=pdf.charCodeAt(i)&255;
    return new Blob([bytes],{type:'application/pdf'});
  }
  window.PAZO_BAION_PDF = {createDocument};
})();
