"use client";

import { useEffect, useState, useCallback } from "react";
import { PLAN_LIMITS } from "@/lib/plans";

/* ─── Types ─────────────────────────────────────────────── */
interface KPI {
  mrr: number; arr: number;
  totalTenants: number; activeTenants: number; trialTenants: number;
  suspendedTenants: number; expiredTenants: number; expiringIn7d: number;
  totalDrivers: number; totalAdmins: number;
  reportsThisMonth: number; reportsAllTime: number;
  grossThisMonth: number; netThisMonth: number; expensesThisMonth: number;
  grossAllTime: number; netAllTime: number;
  conversionRate: number;
}
interface TenantRow {
  id: string; slug: string; name: string; plan: string; active: boolean;
  trial_ends_at: string | null; plan_expires_at: string | null;
  app_name: string; primary_color: string; created_at: string;
  driverCount: number; reportsMonth: number; grossMonth: number; netMonth: number;
  daysLeft: number | null;
}
interface DailyPoint { date: string; reports: number; gross: number; net: number; }

/* ─── Helpers ───────────────────────────────────────────── */
const fmtXOF = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n));
const fmtK = (n: number) => n >= 1_000_000 ? (n/1_000_000).toFixed(1)+"M" : n >= 1_000 ? (n/1_000).toFixed(0)+"k" : String(Math.round(n));
const PLAN_C: Record<string,string> = { standard:"#f5a623", pro:"#8b5cf6" };

/* ─── SVG Line Chart ─────────────────────────────────────── */
function LineChart({ points, height=120 }: { points: { x: number; y: number; label: string }[]; height?: number }) {
  if (points.length < 2) return <div style={{color:"#374151",fontSize:12,padding:20}}>Données insuffisantes</div>;
  const W=560; const H=height; const pad={t:10,r:10,b:28,l:44};
  const iW=W-pad.l-pad.r; const iH=H-pad.t-pad.b;
  const maxY=Math.max(...points.map(p=>p.y),1);
  const px=(i:number)=>pad.l+i*(iW/(points.length-1));
  const py=(v:number)=>pad.t+iH-(v/maxY)*iH;
  const pathD=points.map((p,i)=>`${i===0?"M":"L"}${px(i)},${py(p.y)}`).join(" ");
  const areaD=`${pathD} L${px(points.length-1)},${pad.t+iH} L${px(0)},${pad.t+iH} Z`;
  const ticks=5;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height}}>
      <defs>
        <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5a623" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="#f5a623" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {/* Grid */}
      {Array.from({length:ticks+1},(_,i)=>{
        const v=maxY*(1-i/ticks);
        const y=pad.t+iH*(i/ticks);
        return <g key={i}>
          <line x1={pad.l} y1={y} x2={W-pad.r} y2={y} stroke="#1e2330" strokeWidth={0.5}/>
          <text x={pad.l-4} y={y+4} textAnchor="end" fontSize={9} fill="#374151">{fmtK(v)}</text>
        </g>;
      })}
      {/* X labels — show only every Nth */}
      {points.filter((_,i)=>i%(Math.ceil(points.length/8))===0||i===points.length-1).map((p,_,arr,i=points.indexOf(p))=>(
        <text key={p.label} x={px(i)} y={H-4} textAnchor="middle" fontSize={8} fill="#374151">{p.label.slice(5)}</text>
      ))}
      <path d={areaD} fill="url(#lg1)"/>
      <path d={pathD} fill="none" stroke="#f5a623" strokeWidth={1.5} strokeLinejoin="round"/>
      {points.map((p,i)=>p.y>0&&<circle key={i} cx={px(i)} cy={py(p.y)} r={2} fill="#f5a623"/>)}
    </svg>
  );
}

/* ─── SVG Bar Chart ──────────────────────────────────────── */
function BarChart({ points, color="#f5a623", accent="#8b5cf6", height=100 }:
  { points: DailyPoint[]; color?: string; accent?: string; height?: number }) {
  if (!points.length) return <div style={{color:"#374151",fontSize:12}}>Aucune donnée</div>;
  const W=560; const H=height; const pad={t:8,r:8,b:22,l:8};
  const iW=W-pad.l-pad.r; const iH=H-pad.t-pad.b;
  const barW=Math.max(2,(iW/points.length)*0.75);
  const gap=iW/points.length;
  const maxR=Math.max(...points.map(p=>p.reports),1);
  const maxG=Math.max(...points.map(p=>p.gross),1);
  const showEvery=Math.ceil(points.length/10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height}}>
      {points.map((p,i)=>{
        const x=pad.l+i*gap+(gap-barW)/2;
        const hR=(p.reports/maxR)*iH;
        const hG=(p.gross/maxG)*iH*0.6;
        return <g key={p.date}>
          <rect x={x} y={pad.t+iH-hG} width={barW} height={hG} fill={accent} opacity={0.25} rx={1}/>
          <rect x={x} y={pad.t+iH-hR} width={barW*0.55} height={hR} fill={color} rx={1} opacity={0.9}/>
          {i%showEvery===0&&<text x={x+barW/2} y={H-4} textAnchor="middle" fontSize={7} fill="#374151">{p.date.slice(5)}</text>}
        </g>;
      })}
    </svg>
  );
}

/* ─── Donut ──────────────────────────────────────────────── */
function Donut({ data, size=100 }: { data:{label:string;value:number;color:string}[]; size?:number }) {
  const total=data.reduce((s,d)=>s+d.value,0)||1;
  const R=38; const cx=50; const cy=50; let angle=-90;
  const slices=data.map(d=>{
    const a=(d.value/total)*360; const s=angle; angle+=a;
    return {...d,angle:a,start:s};
  });
  function arc(start:number,ang:number,r:number){
    const s=((start)*Math.PI)/180; const e=((start+ang)*Math.PI)/180;
    return `M${cx+r*Math.cos(s)},${cy+r*Math.sin(s)} A${r},${r} 0 ${ang>180?1:0} 1 ${cx+r*Math.cos(e)},${cy+r*Math.sin(e)}`;
  }
  return (
    <svg viewBox="0 0 100 100" style={{width:size,height:size}}>
      {slices.map((s,i)=>s.angle>0.5&&(
        <path key={i} d={arc(s.start,s.angle,R)+" L"+cx+","+cy+" Z"} fill={s.color} opacity={0.85}/>
      ))}
      <circle cx={cx} cy={cy} r={24} fill="#0d1117"/>
      <text x={cx} y={cy+4} textAnchor="middle" fontSize={11} fill="#f0f2f7" fontWeight="bold">{total}</text>
    </svg>
  );
}

/* ─── Gauge ──────────────────────────────────────────────── */
function Gauge({ value, max, color="#f5a623", label="" }:
  { value:number; max:number; color?:string; label?:string }) {
  const pct=Math.min(value/max,1);
  const R=36; const cx=50; const cy=54;
  const startAngle=-210; const sweepAngle=240;
  const toRad=(d:number)=>(d*Math.PI)/180;
  const arcPath=(r:number,start:number,sweep:number)=>{
    const s=toRad(start); const e=toRad(start+sweep);
    return `M${cx+r*Math.cos(s)},${cy+r*Math.sin(s)} A${r},${r} 0 ${sweep>180?1:0} 1 ${cx+r*Math.cos(e)},${cy+r*Math.sin(e)}`;
  };
  return (
    <svg viewBox="0 0 100 80" style={{width:"100%",height:80}}>
      <path d={arcPath(R,-210,240)} fill="none" stroke="#1e2330" strokeWidth={7} strokeLinecap="round"/>
      {pct>0&&<path d={arcPath(R,-210,sweepAngle*pct)} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"/>}
      <text x={cx} y={cy-6} textAnchor="middle" fontSize={14} fill={color} fontWeight="bold">{Math.round(pct*100)}%</text>
      <text x={cx} y={cy+6} textAnchor="middle" fontSize={8} fill="#6b7280">{label}</text>
    </svg>
  );
}

/* ─── KPI Card ───────────────────────────────────────────── */
function Card({ icon,label,value,sub,color="#f5a623",border }:{icon:string;label:string;value:string;sub?:string;color?:string;border?:string}) {
  return (
    <div style={{background:"#0d1117",border:`0.5px solid ${border||"#1e2330"}`,borderRadius:12,padding:"16px 18px",flex:1,minWidth:130}}>
      <div style={{fontSize:18,marginBottom:4}}>{icon}</div>
      <div style={{fontSize:20,fontWeight:800,color,letterSpacing:"-0.5px",lineHeight:1}}>{value}</div>
      <div style={{fontSize:11,color:"#6b7280",marginTop:3}}>{label}</div>
      {sub&&<div style={{fontSize:10,color:"#374151",marginTop:3}}>{sub}</div>}
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────── */
export default function Dashboard({ superadminKey }: { superadminKey: string }) {
  const [kpi,setKpi]=useState<KPI|null>(null);
  const [rows,setRows]=useState<TenantRow[]>([]);
  const [daily,setDaily]=useState<DailyPoint[]>([]);
  const [loading,setLoading]=useState(true);
  const [sortBy,setSortBy]=useState<keyof TenantRow>("grossMonth");

  const load=useCallback(async()=>{
    setLoading(true);
    const res=await fetch("/api/superadmin/console",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({superadminKey,op:"dashboard"}),
    });
    const { tenants, profiles, rMonth, rAll, rDaily, settings, error }=await res.json();
    if(error){setLoading(false);return;}

    const sMap:Record<string,any>={};
    (settings||[]).forEach((s:any)=>{sMap[s.tenant_id]=s;});

    const drivers:Record<string,number>={};
    const admins:Record<string,number>={};
    (profiles||[]).forEach((p:any)=>{
      if(p.role==="driver") drivers[p.tenant_id]=(drivers[p.tenant_id]||0)+1;
      if(p.role==="admin") admins[p.tenant_id]=(admins[p.tenant_id]||0)+1;
    });

    const rByT:Record<string,{count:number;gross:number;net:number}>={};
    (rMonth||[]).forEach((r:any)=>{
      if(!rByT[r.tenant_id]) rByT[r.tenant_id]={count:0,gross:0,net:0};
      rByT[r.tenant_id].count++;
      rByT[r.tenant_id].gross+=r.gross_earnings||0;
      rByT[r.tenant_id].net+=r.net_after_expenses||0;
    });

    const dMap:Record<string,DailyPoint>={};
    (rDaily||[]).forEach((r:any)=>{
      if(!dMap[r.date]) dMap[r.date]={date:r.date,reports:0,gross:0,net:0};
      dMap[r.date].reports++;
      dMap[r.date].gross+=r.gross_earnings||0;
      dMap[r.date].net+=r.net_after_expenses||0;
    });
    setDaily(Object.values(dMap).sort((a,b)=>a.date.localeCompare(b.date)));

    let mrr=0,active=0,trial=0,suspended=0,expired=0,expiring7=0;
    const tRows:TenantRow[]=(tenants||[]).map((t:any)=>{
      const expiresAt=t.plan_expires_at??t.trial_ends_at;
      const daysLeft=expiresAt?Math.ceil((new Date(expiresAt).getTime()-Date.now())/864e5):null;
      const exp=daysLeft!==null&&daysLeft<=0;
      const isTrial=!t.plan_expires_at&&!!t.trial_ends_at;
      if(!t.active) suspended++;
      else if(exp) expired++;
      else if(isTrial) trial++;
      else { active++; mrr+=PLAN_LIMITS[t.plan as "standard"|"pro"]?.priceXOF||0; }
      if(daysLeft!==null&&daysLeft>0&&daysLeft<=7) expiring7++;
      return {
        id:t.id,slug:t.slug,name:t.name,plan:t.plan,active:t.active,
        trial_ends_at:t.trial_ends_at,plan_expires_at:t.plan_expires_at,created_at:t.created_at,
        app_name:sMap[t.id]?.app_name||t.name,primary_color:sMap[t.id]?.primary_color||"#f5a623",
        driverCount:drivers[t.id]||0,
        reportsMonth:rByT[t.id]?.count||0,grossMonth:rByT[t.id]?.gross||0,netMonth:rByT[t.id]?.net||0,
        daysLeft,
      };
    });
    setRows(tRows);

    const gMonth=(rMonth||[]).reduce((s:number,r:any)=>s+(r.gross_earnings||0),0);
    const nMonth=(rMonth||[]).reduce((s:number,r:any)=>s+(r.net_after_expenses||0),0);
    const gAll=(rAll||[]).reduce((s:number,r:any)=>s+(r.gross_earnings||0),0);
    const nAll=(rAll||[]).reduce((s:number,r:any)=>s+(r.net_after_expenses||0),0);
    const paidTenants=tRows.filter(t=>t.plan_expires_at&&t.active).length;
    const conv=trial+paidTenants>0?(paidTenants/(trial+paidTenants))*100:0;

    setKpi({
      mrr,arr:mrr*12,totalTenants:(tenants||[]).length,
      activeTenants:active,trialTenants:trial,suspendedTenants:suspended,expiredTenants:expired,expiringIn7d:expiring7,
      totalDrivers:Object.values(drivers).reduce((a,b)=>a+b,0),
      totalAdmins:Object.values(admins).reduce((a,b)=>a+b,0),
      reportsThisMonth:(rMonth||[]).length,reportsAllTime:(rAll||[]).length,
      grossThisMonth:gMonth,netThisMonth:nMonth,expensesThisMonth:gMonth-nMonth,
      grossAllTime:gAll,netAllTime:nAll,conversionRate:conv,
    });
    setLoading(false);
  },[superadminKey]);

  useEffect(()=>{load();},[load]);

  const sorted=[...rows].sort((a,b)=>{
    const av=a[sortBy], bv=b[sortBy];
    if(typeof av==="number"&&typeof bv==="number") return bv-av;
    return 0;
  });

  const planCounts=rows.reduce((acc,t)=>({...acc,[t.plan]:(acc[t.plan]||0)+1}),{} as Record<string,number>);
  const expiring=rows.filter(t=>t.daysLeft!==null&&t.daysLeft>0&&t.daysLeft<=14).sort((a,b)=>(a.daysLeft??0)-(b.daysLeft??0));

  // Build line chart data from daily points
  const lineData=daily.map(p=>({x:0,y:p.gross,label:p.date}));
  const reportLineData=daily.map(p=>({x:0,y:p.reports,label:p.date}));

  const R: React.CSSProperties = {};

  if(loading) return (
    <div style={{display:"flex",alignItems:"center",gap:12,color:"#6b7280",padding:"48px 0"}}>
      <svg width={20} height={20} viewBox="0 0 20 20" style={{animation:"spin 1s linear infinite"}}>
        <circle cx={10} cy={10} r={8} fill="none" stroke="#f5a623" strokeWidth={2} strokeDasharray="25 15"/>
      </svg>
      Chargement des données…
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      {/* ── ROW 1 : KPI CARDS ── */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>
        <Card icon="💰" label="MRR" value={`${fmtXOF(kpi!.mrr)} XOF`} sub={`ARR: ${fmtXOF(kpi!.arr)} XOF`} color="#f5a623"/>
        <Card icon="🏢" label="Clients payants" value={String(kpi!.activeTenants)} sub={`${kpi!.trialTenants} en essai`} color="#22c55e"/>
        <Card icon="🔄" label="Conversion trial→payant" value={`${Math.round(kpi!.conversionRate)}%`} color="#60a5fa"/>
        <Card icon="🚗" label="Chauffeurs total" value={String(kpi!.totalDrivers)} sub={`${kpi!.totalAdmins} admins`} color="#a78bfa"/>
        <Card icon="📋" label="Rapports ce mois" value={String(kpi!.reportsThisMonth)} sub={`${fmtK(kpi!.reportsAllTime)} all-time`} color="#34d399"/>
        <Card icon="⚠️" label="Expirent < 7j" value={String(kpi!.expiringIn7d)} color={kpi!.expiringIn7d>0?"#f97316":"#374151"} border={kpi!.expiringIn7d>0?"#f9731640":undefined}/>
      </div>

      {/* ── ROW 2 : FINANCIAL KPIs ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:20}}>
        {[
          {label:"CA géré ce mois",value:fmtXOF(kpi!.grossThisMonth)+" XOF",color:"#34d399"},
          {label:"Net ce mois",value:fmtXOF(kpi!.netThisMonth)+" XOF",color:"#60a5fa"},
          {label:"Dépenses ce mois",value:fmtXOF(kpi!.expensesThisMonth)+" XOF",color:"#f87171"},
          {label:"CA all-time",value:fmtXOF(kpi!.grossAllTime)+" XOF",color:"#f5a623"},
        ].map(({label,value,color})=>(
          <div key={label} style={{background:"#0d1117",border:"0.5px solid #1e2330",borderRadius:10,padding:"12px 16px"}}>
            <div style={{fontSize:10,color:"#6b7280",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</div>
            <div style={{fontSize:14,fontWeight:800,color}}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── ROW 3 : ALERTS ── */}
      {expiring.length>0&&(
        <div style={{background:"#0f0b0015",border:"1px solid #f9731630",borderRadius:12,padding:"14px 18px",marginBottom:20}}>
          <div style={{fontSize:11,color:"#f97316",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>⚠ Expirent bientôt</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {expiring.map(t=>{
              const c=t.daysLeft!<=1?"#ef4444":t.daysLeft!<=3?"#f97316":t.daysLeft!<=7?"#f5a623":"#22c55e";
              return (
                <div key={t.id} style={{background:"#0d1117",border:`1px solid ${c}30`,borderRadius:8,padding:"8px 14px",display:"flex",alignItems:"center",gap:10}}>
                  <span style={{width:7,height:7,borderRadius:"50%",background:c,display:"inline-block",flexShrink:0}}/>
                  <div>
                    <div style={{fontSize:12,fontWeight:700,color:"#f0f2f7"}}>{t.app_name}</div>
                    <div style={{fontSize:10,color:"#6b7280"}}>J-{t.daysLeft} · {t.plan} · {t.driverCount} drivers</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ROW 4 : CHARTS ── */}
      {/* auto-fit : 2 colonnes sur desktop, 1 colonne sur mobile (pas de coupure) */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16,marginBottom:20}}>

        {/* CA journalier — line chart */}
        <div style={{background:"#0d1117",border:"0.5px solid #1e2330",borderRadius:12,padding:"18px 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:"#f0f2f7"}}>CA journalier — 30j</div>
              <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>Chiffre d'affaires brut en XOF</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:16,fontWeight:800,color:"#f5a623"}}>{fmtK(kpi!.grossThisMonth)}</div>
              <div style={{fontSize:9,color:"#6b7280"}}>XOF ce mois</div>
            </div>
          </div>
          <LineChart points={lineData} height={120}/>
        </div>

        {/* Rapports/jour — bar chart */}
        <div style={{background:"#0d1117",border:"0.5px solid #1e2330",borderRadius:12,padding:"18px 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:"#f0f2f7"}}>Rapports / jour — 30j</div>
              <div style={{fontSize:10,color:"#6b7280",marginTop:2}}>
                <span style={{color:"#f5a623"}}>▌</span> Rapports &nbsp;
                <span style={{color:"#8b5cf640"}}>▌</span> CA relatif
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:16,fontWeight:800,color:"#8b5cf6"}}>{kpi!.reportsThisMonth}</div>
              <div style={{fontSize:9,color:"#6b7280"}}>rapports ce mois</div>
            </div>
          </div>
          <BarChart points={daily} color="#8b5cf6" accent="#f5a623" height={120}/>
        </div>

        {/* Répartition plans + conversion */}
        <div style={{background:"#0d1117",border:"0.5px solid #1e2330",borderRadius:12,padding:"18px 20px"}}>
          <div style={{fontWeight:700,fontSize:13,color:"#f0f2f7",marginBottom:14}}>Répartition clients</div>
          <div style={{display:"flex",gap:20,alignItems:"center"}}>
            <Donut data={[
              {label:"Standard",value:planCounts["standard"]||0,color:"#f5a623"},
              {label:"Pro",value:planCounts["pro"]||0,color:"#8b5cf6"},
              {label:"Essai",value:kpi!.trialTenants,color:"#374151"},
              {label:"Suspendu",value:kpi!.suspendedTenants+kpi!.expiredTenants,color:"#1e2330"},
            ]} size={110}/>
            <div style={{flex:1}}>
              {[
                {label:"Standard payant",count:planCounts["standard"]||0,color:"#f5a623",revenue:(planCounts["standard"]||0)*PLAN_LIMITS.standard.priceXOF},
                {label:"Pro payant",count:planCounts["pro"]||0,color:"#8b5cf6",revenue:(planCounts["pro"]||0)*PLAN_LIMITS.pro.priceXOF},
                {label:"En essai",count:kpi!.trialTenants,color:"#374151",revenue:0},
                {label:"Inactifs",count:kpi!.suspendedTenants+kpi!.expiredTenants,color:"#1e2330",revenue:0},
              ].map(({label,count,color,revenue})=>(
                <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{width:8,height:8,borderRadius:2,background:color,display:"inline-block",flexShrink:0}}/>
                    <span style={{fontSize:11,color:"#9ca3af"}}>{label} ({count})</span>
                  </div>
                  <span style={{fontSize:11,color:revenue>0?color:"#374151",fontWeight:700}}>{revenue>0?fmtXOF(revenue)+" XOF":"—"}</span>
                </div>
              ))}
              <div style={{borderTop:"0.5px solid #1e2330",paddingTop:8,marginTop:4,display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:11,color:"#9ca3af",fontWeight:700}}>MRR</span>
                <span style={{fontSize:13,color:"#f5a623",fontWeight:800}}>{fmtXOF(kpi!.mrr)} XOF</span>
              </div>
            </div>
          </div>
        </div>

        {/* Gauges */}
        <div style={{background:"#0d1117",border:"0.5px solid #1e2330",borderRadius:12,padding:"18px 20px"}}>
          <div style={{fontWeight:700,fontSize:13,color:"#f0f2f7",marginBottom:14}}>Indicateurs santé</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            <div style={{textAlign:"center"}}>
              <Gauge value={kpi!.conversionRate} max={100} color="#22c55e" label="Conversion"/>
              <div style={{fontSize:10,color:"#6b7280"}}>Trial → Payant</div>
            </div>
            <div style={{textAlign:"center"}}>
              <Gauge value={kpi!.activeTenants} max={Math.max(kpi!.totalTenants,1)} color="#f5a623" label="Taux actif"/>
              <div style={{fontSize:10,color:"#6b7280"}}>Clients actifs</div>
            </div>
            <div style={{textAlign:"center"}}>
              <Gauge value={kpi!.netThisMonth} max={Math.max(kpi!.grossThisMonth,1)} color="#60a5fa" label="Marge nette"/>
              <div style={{fontSize:10,color:"#6b7280"}}>Net / Brut</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── ROW 5 : TENANT TABLE ── */}
      <div style={{background:"#0d1117",border:"0.5px solid #1e2330",borderRadius:12,overflow:"hidden"}}>
        <div style={{padding:"14px 18px",display:"flex",alignItems:"center",gap:10,borderBottom:"0.5px solid #1e2330",flexWrap:"wrap"}}>
          <div style={{fontWeight:700,fontSize:13,color:"#f0f2f7",flex:1}}>Détail par client ({rows.length})</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {(["grossMonth","reportsMonth","driverCount","daysLeft","netMonth"] as const).map(col=>(
              <button key={col} onClick={()=>setSortBy(col)}
                style={{background:sortBy===col?"#f5a62318":"#080a0f",border:`0.5px solid ${sortBy===col?"#f5a62350":"#1e2330"}`,borderRadius:6,padding:"4px 10px",color:sortBy===col?"#f5a623":"#6b7280",cursor:"pointer",fontSize:10,fontWeight:sortBy===col?700:400}}>
                {col==="grossMonth"?"CA mois":col==="reportsMonth"?"Rapports":col==="driverCount"?"Drivers":col==="daysLeft"?"Expiry":"Net mois"}
              </button>
            ))}
          </div>
          <button onClick={load} style={{background:"#1e2330",border:"none",borderRadius:6,padding:"4px 10px",color:"#9ca3af",cursor:"pointer",fontSize:10}}>↻</button>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead>
              <tr style={{borderBottom:"0.5px solid #1e2330"}}>
                {["Client","Plan","Statut","Drivers","Rapports/m","CA mois","Net mois","Dépenses/m","Expiry","Créé le"].map(h=>(
                  <th key={h} style={{padding:"9px 14px",color:"#6b7280",fontWeight:600,textAlign:"left",whiteSpace:"nowrap",fontSize:10}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t,i)=>{
                const exp=t.daysLeft!==null&&t.daysLeft<=0;
                const warn=t.daysLeft!==null&&t.daysLeft>0&&t.daysLeft<=7;
                const ec=exp?"#ef4444":warn?"#f97316":t.daysLeft!==null&&t.daysLeft<=14?"#f5a623":"#22c55e";
                return (
                  <tr key={t.id} style={{borderBottom:"0.5px solid #1e2330",background:i%2===0?"transparent":"#08080810"}}>
                    <td style={{padding:"10px 14px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        <div style={{width:24,height:24,borderRadius:5,background:t.primary_color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#080a0f",flexShrink:0}}>
                          {t.app_name.slice(0,2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{fontWeight:600,color:"#f0f2f7"}}>{t.app_name}</div>
                          <div style={{color:"#374151",fontSize:9}}>{t.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{padding:"10px 14px"}}>
                      <span style={{background:(PLAN_C[t.plan]||"#6b7280")+"18",color:PLAN_C[t.plan]||"#6b7280",border:`0.5px solid ${(PLAN_C[t.plan]||"#6b7280")}40`,borderRadius:20,padding:"2px 8px",fontWeight:700,fontSize:10}}>
                        {t.plan}
                      </span>
                    </td>
                    <td style={{padding:"10px 14px"}}>
                      <span style={{color:t.active&&!exp?"#22c55e":"#ef4444",fontSize:10}}>
                        {!t.active?"Suspendu":exp?"Expiré":t.plan_expires_at?"Payant":"Essai"}
                      </span>
                    </td>
                    <td style={{padding:"10px 14px",color:"#f0f2f7",fontWeight:600,textAlign:"right"}}>{t.driverCount}</td>
                    <td style={{padding:"10px 14px",color:"#a78bfa",fontWeight:600,textAlign:"right"}}>{t.reportsMonth}</td>
                    <td style={{padding:"10px 14px",color:"#34d399",fontWeight:700,textAlign:"right"}}>{t.grossMonth>0?fmtK(t.grossMonth)+" XOF":"—"}</td>
                    <td style={{padding:"10px 14px",color:"#60a5fa",fontWeight:700,textAlign:"right"}}>{t.netMonth>0?fmtK(t.netMonth)+" XOF":"—"}</td>
                    <td style={{padding:"10px 14px",color:"#f87171",textAlign:"right"}}>{t.grossMonth-t.netMonth>0?fmtK(t.grossMonth-t.netMonth)+" XOF":"—"}</td>
                    <td style={{padding:"10px 14px"}}>
                      <span style={{color:ec,fontWeight:700}}>
                        {t.daysLeft===null?"—":t.daysLeft<=0?"Expiré":`J-${t.daysLeft}`}
                      </span>
                    </td>
                    <td style={{padding:"10px 14px",color:"#374151",fontSize:10}}>
                      {new Date(t.created_at).toLocaleDateString("fr-FR")}
                    </td>
                  </tr>
                );
              })}
              {sorted.length===0&&(
                <tr><td colSpan={10} style={{padding:32,textAlign:"center",color:"#374151"}}>Aucun client</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
