// Browser-global request ownership and paginated completeness tracking.
function requestGate(){
  let generation = 0;
  return { invalidate(){ return ++generation; }, current(id){ return id === generation; } };
}

function guardedPanel(panel, current){
  return new Proxy(panel, {
    set(target, key, value){ if(current()) target[key] = value; return true; },
    get(target, key){ const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; }
  });
}

class QueryLedger {
  constructor(conditions, fetchPage, field, normalize = x=>x){
    this.conditions = conditions;
    this.fetchPage = fetchPage;
    this.field = field;
    this.normalize = normalize;
    this.time = new Date().toISOString();
    this.requests = new Map();
    this.busy = false;
  }
  key(t){ return JSON.stringify([t.bjd, t.type || 'page', t.pg || 1, t.bun, t.ji]); }
  async collect(tasks){
    const queue = tasks.slice();
    const worker = async()=>{
      while(queue.length && (!this.active || this.active())){
        const task = queue.shift(), key = this.key(task);
        let result;
        try { result = await this.fetchPage(task); }
        catch { result = { error:'요청 실패' }; }
        if(this.active && !this.active()) return;
        const rows = result?.[this.field];
        let error = result?.error || (!Array.isArray(rows) ? '응답 형식 오류' : null);
        const total = Number(result?.totalCount);
        if(!error && task.type !== 'parcel' && (task.pg || 1) === 1 &&
          (result?.totalCount == null || String(result.totalCount).trim()==='' || !Number.isFinite(total) || total < rows.length || (!rows.length && total > 0))) error = '전체 페이지 수 확인 불가';
        if(!error && task.type !== 'parcel' && (task.pg || 1) > 1 && !rows.length) error = '예상 페이지 자료 미수신';
        if(!error && task.expectedRows && rows.length < task.expectedRows) error = '예상 페이지 일부 자료 미수신';
        let normalized = [];
        if(!error){
          try {
            normalized = rows.map(x=>{
              if(!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('invalid row');
              return this.normalize(x, task.bjd);
            });
          }catch { error = '응답 행 형식 오류'; }
        }
        const record = { task, ok:!error, error, rows:error ? [] : normalized };
        this.requests.set(key, record);
        if(record.ok && task.type !== 'parcel' && (task.pg || 1) === 1 && rows.length){
          const pages = Math.ceil(total / rows.length);
          for(let pg=2; pg<=Math.min(pages,100); pg++){
            const next = { bjd:task.bjd, pg, expectedRows:Math.min(rows.length, total-(pg-1)*rows.length) };
            if(!this.requests.has(this.key(next))) queue.push(next);
          }
          if(pages > 100) this.requests.set(key+':limit', { task:{...task, pg:'101+'}, ok:false, error:'조회 상한 초과', rows:[], limit:true });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    this.time = new Date().toISOString();
    return this.rows();
  }
  rows(){
    const seen = new Set();
    return [...this.requests.values()].flatMap(r=>r.rows).filter(row=>{
      // HUB may send a PK beyond Number.MAX_SAFE_INTEGER. Never merge by that rounded number.
      const key = JSON.stringify(Object.fromEntries(Object.keys(row).filter(k=>k !== 'rnum' && k !== 'hdong').sort().map(k=>[k,row[k]])));
      if(seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  failed(){ return [...this.requests.values()].filter(r=>!r.ok); }
  status(){
    const success = [...this.requests.values()].filter(r=>r.ok).length;
    return this.failed().length ? (success ? '부분 조회' : '전체 실패') : (this.rows().length ? '전체 성공' : '정상 0건');
  }
  async retry(){
    if(this.busy) return;
    this.busy = true;
    try { await this.collect(this.failed().filter(r=>!r.limit).map(r=>r.task)); }
    finally { this.busy = false; }
  }
  info(){
    const records = [...this.requests.values()];
    return [
      ['조회 상태',this.status()], ['조회시각',this.time], ['검색 조건',this.description || this.conditions],
      ['성공 요청 수',records.filter(r=>r.ok).length], ['실패 요청 수',this.failed().length],
      ['완전성',this.failed().length ? '일부 범위 미조회: 전체 건수 및 결과 완전성을 보장할 수 없습니다.' : '요청한 범위의 페이지 조회 완료. 원본 데이터 정확성을 보증하지 않습니다.'],
      ['범위','페이지','성공 여부'],
      ...records.map(r=>[`${r.task.bjd}${r.task.type==='parcel' ? ` ${r.task.bun}-${r.task.ji}` : ''}`,r.task.pg || 1,r.ok ? '성공' : '실패'])
    ];
  }
}

function seismicLabel(value){
  // 건축HUB rserthqkDsgnApplyYn: 1=적용, 0=미적용. Other/missing codes are not inferred.
  const code = String(value ?? '').trim();
  return code === '1' ? '적용' : code === '0' ? '미적용' : '미확인';
}
