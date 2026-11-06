/* PAZO BAION GPS v9.6.1 — generador PDF documental local, sin servidores ni librerías externas.
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
      T(M,46,'INFORME DOCUMENTAL · BETA v9.6.1',8,false,MUTED);
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
      const points=(work.pointsClean || []).filter(valid);
      if(points.length<2){textParagraph('No hay suficientes puntos GPS válidos para dibujar el recorrido.');return;}
      needed(260);
      const bx=M+8, by=y+14, bw=PW-M*2-16, bh=197;
      rect(M,y,PW-M*2,228,LIGHT);
      T(bx+5,by+12,'Croquis GPS vectorial (sin imagen satelital, orientación aproximada)',8,false,MUTED);
      const lat=points.map(p=>Number(p.lat)), lng=points.map(p=>Number(p.lng));
      let loX=Math.min(...lng), hiX=Math.max(...lng), loY=Math.min(...lat), hiY=Math.max(...lat);
      const dx=Math.max(1e-9,hiX-loX), dy=Math.max(1e-9,hiY-loY);
      const factor=Math.min((bw-28)/dx,(bh-52)/dy);
      const mapx=x=>bx+14+(x-loX)*factor+((bw-28)-dx*factor)/2;
      const mapy=v=>by+bh-13-(v-loY)*factor-((bh-52)-dy*factor)/2;
      let commands=`0.14 0.49 0.72 RG 1.75 w `;
      points.forEach((p,i)=>{commands+=`${f2(mapx(Number(p.lng)))} ${f2(PH-mapy(Number(p.lat)))} ${i?'l':'m'} `;});
      ops.push(commands+'S');
      const a=points[0],b=points[points.length-1];
      for(const [pt,fill] of [[a,[.2,.55,.27]],[b,[.66,.22,.16]]]){
        ops.push(`${col(fill)} rg ${f2(mapx(Number(pt.lng))-3.5)} ${f2(PH-mapy(Number(pt.lat))-3.5)} 7 7 re f`);
      }
      T(bx+7,by+bh+7,`${points.length} puntos depurados · inicio verde / fin rojo`,8,false,MUTED);
      y+=240;
    }
    page();
    T(M,y,'RESUMEN DEL TRABAJO',15,true);y+=25;
    row('Estado',payload.completed?'Informe definitivo':'Trabajo pendiente (no definitivo)');
    row('Parcela',work.parcel || '—');
    row('Labor',work.type || '—');
    row('Fecha de inicio',dt(work.startedAt));
    row('Fecha de fin',dt(work.finishedAt));
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
    textParagraph('Este informe se genera localmente. Los recorridos y estadísticas dependen de la precisión GPS, el estado del dispositivo y la disponibilidad de red. El mapa representado es esquemático, no una ortofoto.');
    pages.push(ops);
    // Añadir numeración y pie independiente a todas las páginas.
    pages.forEach((page,index)=>{
      page.push(`${col(GOLD)} RG 0.75 w ${f2(M)} 55 m ${f2(PW-M)} 55 l S`);
      page.push(`${col(MUTED)} rg BT /FR 8 Tf 1 0 0 1 ${f2(M)} 40 Tm ${quote('Pazo Baion GPS · Beta v9.6.1 · Documento generado localmente')} Tj ET`);
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
