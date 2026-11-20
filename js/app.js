

/* Production and catalog data are sourced exclusively from Supabase. */

let brandProducts={};
const productModels={};
let pmBrandNames=[];
let pmProductNames=[];
let pmModelNumbers=[];
const hours=['09:00 AM–10:00 AM','10:00 AM–11:00 AM','11:00 AM–12:00 PM','12:00 PM–01:00 PM','01:00 PM–02:00 PM','02:00 PM–03:00 PM','03:00 PM–04:00 PM','04:00 PM–05:00 PM'];
let plans=[];
let editingPlanId=null;
let pmProductionDataLoaded=false;


function pmRequireDb(){
  const db=window.pmSupabaseClient;
  if(!db)throw new Error('Supabase client is not ready. Please refresh and sign in again.');
  return db;
}
function pmThrowDbError(result,context){
  if(result&&result.error)throw new Error((context?context+': ':'')+result.error.message);
  return result&&result.data;
}
function pmDbTime(value){
  return String(value||'').slice(0,5);
}
function pmTitleStatus(value){
  return String(value||'draft').charAt(0).toUpperCase()+String(value||'draft').slice(1);
}
async function pmLoadProductionData(client){
  const db=client||pmRequireDb();
  const [brandResult,productResult,modelResult,planResult]=await Promise.all([
    db.from('pm_brands').select('id,name').order('name'),
    db.from('pm_products').select('id,brand_id,name').order('name'),
    db.from('pm_models').select('id,product_id,model_number').order('model_number'),
    db.from('pm_production_plans').select('*').order('plan_date',{ascending:false}).order('created_at',{ascending:false})
  ]);
  const brands=pmThrowDbError(brandResult,'Loading brands')||[];
  const products=pmThrowDbError(productResult,'Loading products')||[];
  const models=pmThrowDbError(modelResult,'Loading models')||[];
  const dbPlans=pmThrowDbError(planResult,'Loading production plans')||[];
  const planIds=dbPlans.map(p=>p.id);
  const [targetResult,hourResult]=planIds.length?await Promise.all([
    db.from('pm_plan_hour_targets').select('*').in('plan_id',planIds).order('hour_index'),
    db.from('pm_hourly_production').select('*').in('plan_id',planIds).order('hour_index')
  ]):[{data:[],error:null},{data:[],error:null}];
  const targets=pmThrowDbError(targetResult,'Loading hourly targets')||[];
  const hourly=pmThrowDbError(hourResult,'Loading hourly production')||[];
  const hourlyIds=hourly.map(h=>h.id);
  const reworkResult=hourlyIds.length
    ?await db.from('pm_rework_units').select('*').in('hourly_production_id',hourlyIds).order('unit_number')
    :{data:[],error:null};
  const rework=pmThrowDbError(reworkResult,'Loading rework records')||[];

  const brandById=new Map(brands.map(b=>[b.id,b]));
  const productById=new Map(products.map(p=>[p.id,p]));
  const modelById=new Map(models.map(m=>[m.id,m]));

  pmBrandNames=brands.map(b=>b.name).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  pmProductNames=products.map(p=>p.name).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  pmModelNumbers=models.map(m=>m.model_number).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  brandProducts={};
  pmBrandNames.forEach(name=>{brandProducts[name]={};});

  const targetsByPlan=new Map();
  targets.forEach(t=>{
    if(!targetsByPlan.has(t.plan_id))targetsByPlan.set(t.plan_id,[]);
    targetsByPlan.get(t.plan_id)[Number(t.hour_index)]=t;
  });
  const reworkByHour=new Map();
  rework.forEach(unit=>{
    if(!reworkByHour.has(unit.hourly_production_id))reworkByHour.set(unit.hourly_production_id,[]);
    reworkByHour.get(unit.hourly_production_id).push(unit);
  });
  const entriesByPlan=new Map();
  hourly.forEach(record=>{
    const units=(reworkByHour.get(record.id)||[]).map(unit=>({
      dbId:unit.id,
      unitNumber:unit.unit_number,
      serial:unit.serial_number||'',
      reason:unit.original_reason||record.rejection_reason||'',
      status:unit.status==='completed'?'Completed':unit.status==='finally_rejected'?'Finally Rejected':'Pending',
      remark:unit.resolution_remark||'',
      resolvedAt:unit.resolved_at||null,
      resolvedBy:unit.resolved_by||null
    }));
    const entry={
      dbId:record.id,
      actual:Number(record.actual_qty)||0,
      rejected:Number(record.rejected_qty)||0,
      startSerial:record.serial_start||'',
      endSerial:record.serial_end||'',
      reason:record.rejection_reason||'',
      remarks:record.remarks||'',
      missingSerialQty:Number(record.missing_serial_qty)||0,
      missingSerialStart:record.missing_serial_start||'',
      missingSerialEnd:record.missing_serial_end||'',
      alternateSerialStart:record.alternate_serial_start||'',
      alternateSerialEnd:record.alternate_serial_end||'',
      serialExceptions:Array.isArray(record.serial_exceptions)?record.serial_exceptions:[],
      recordedAt:record.recorded_at,
      recordedBy:record.recorded_by,
      reworkItems:units,
      locked:true
    };
    if(!entriesByPlan.has(record.plan_id))entriesByPlan.set(record.plan_id,{});
    entriesByPlan.get(record.plan_id)[Number(record.hour_index)]=entry;
  });

  plans=dbPlans.map(row=>{
    const brand=brandById.get(row.brand_id);
    const product=productById.get(row.product_id);
    const model=modelById.get(row.model_id);
    const targetRows=(targetsByPlan.get(row.id)||[]).filter(Boolean).sort((a,b)=>Number(a.hour_index)-Number(b.hour_index));
    const hourTargets=targetRows.map(t=>Number(t.planned_qty)||0);
    const hourLabels=targetRows.map(t=>formatHourRange12(t.hour_label));
    const plan={
      id:row.id,
      date:row.plan_date,
      shift:row.shift,
      line:row.line,
      brand:brand?brand.name:'',
      product:product?product.name:'',
      model:model?model.model_number:'',
      qty:Number(row.planned_qty)||0,
      start:pmDbTime(row.start_time),
      end:pmDbTime(row.end_time),
      breakTimes:Array.isArray(row.break_times)?row.break_times:[],
      supervisor:row.supervisor_name||'',
      status:pmTitleStatus(row.status),
      hourTargets:hourTargets,
      hourLabels:hourLabels,
      entries:entriesByPlan.get(row.id)||{},
      actual:0,
      rejection:0,
      createdBy:row.created_by,
      createdAt:row.created_at
    };
    recalcPlan(plan);
    return plan;
  });
  pmProductionDataLoaded=true;
  refreshProductOptions();
  syncAll();
  return {brands:brands.length,products:products.length,models:models.length,plans:plans.length};
}
window.pmLoadProductionData=pmLoadProductionData;
async function pmReloadProductionData(){
  const result=await pmLoadProductionData();
  return result;
}

function sumEntries(p,key){return Object.values(p.entries||{}).reduce((a,e)=>a+(Number(e[key])||0),0)}
function getHourlyActual(p,h){return Number(p.entries?.[h]?.actual)||0}
function getHourlyRejected(p,h){return Number(p.entries?.[h]?.rejected)||0}
function planHourTargets(p){
  if(Array.isArray(p.hourTargets))return p.hourTargets;
  return timeSlots(p.start,p.end).map(function(){return 0;});
}
function recalcPlan(p){p.actual=sumEntries(p,'actual');p.rejection=sumEntries(p,'rejected');}
function showPage(page){
  var modal=document.getElementById('modal');
  if(modal&&!modal.classList.contains('hidden'))closePlanModal();
  document.querySelectorAll('.page').forEach(function(x){x.classList.add('hidden');});
  var target=document.getElementById(page);
  if(!target)return;
  target.classList.remove('hidden');
  document.querySelectorAll('.nav button').forEach(function(b){b.classList.toggle('active',b.dataset.page===page);});
  var labels={overview:'Overview',plans:'Production Plans',operator:'Operator Workspace',reports:'Production Reports',rework:'Rework Workspace'};
  var crumb=document.getElementById('crumb');if(crumb)crumb.textContent=labels[page]||page;
  if(page==='plans')renderPlans();
  if(page==='operator')renderOperator();
  if(page==='rework')renderRework();
  if(page==='overview'){requestAnimationFrame(renderOverviewChart);setTimeout(renderOverviewChart,80);}
  if(window.pmProductionDataLoaded&&window.pmReloadProductionData){
    window.pmReloadProductionData().catch(function(error){toast('Could not refresh shared data: '+error.message);});
  }
}
let pageHistory=['overview'];if(!history.state)history.replaceState({pmPage:'overview'},'',location.pathname+'#overview');function navigatePage(page,fromPop=false){if(!fromPop&&pageHistory[pageHistory.length-1]!==page){pageHistory.push(page);history.pushState({pmPage:page},'',`#${page}`);}showPage(page); }document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>navigatePage(b.dataset.page)));window.addEventListener('popstate',e=>{let page=e.state?.pmPage||'overview';let idx=pageHistory.lastIndexOf(page);pageHistory=idx>=0?pageHistory.slice(0,idx+1):[page];showPage(page);});window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('modal').classList.contains('hidden'))closePlanModal();});document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')closePlanModal();});

function installUniversalPopupControls(){
  var host=document.getElementById('modal');
  if(!host||host.dataset.pmPopupControls)return;
  host.dataset.pmPopupControls='1';
  var observer=new MutationObserver(function(){
    host.querySelectorAll('.modal').forEach(function(panel){
      if(panel.querySelector(':scope > .pm-popup-back'))return;
      var back=document.createElement('button');
      back.type='button';
      back.className='pm-popup-back';
      back.textContent='← Back / Close';
      back.addEventListener('click',function(){closePlanModal();});
      panel.insertBefore(back,panel.firstChild);
    });
  });
  observer.observe(host,{childList:true,subtree:true});
  host.addEventListener('focusin',function(event){
    var el=event.target;
    if(!el||!el.matches('input,select,textarea'))return;
    if(window.matchMedia&&window.matchMedia('(max-width: 760px)').matches){
      setTimeout(function(){el.scrollIntoView({block:'center',behavior:'smooth'});},220);
    }
  });
}
installUniversalPopupControls();

function renderPlans(){
  var el=document.getElementById('planlist');if(!el)return;
  el.innerHTML=plans.map(function(p){
    var breakText=(p.breakTimes||[]).map(function(x){
      return formatTime12(x.start_time||x.start)+'–'+formatTime12(x.end_time||x.end);
    }).join(', ');
    return '<div class="plan"><h3>'+escapeHtml(p.line)+' · '+escapeHtml(p.brand||'Unbranded')+' · '+escapeHtml(p.product)+' · '+escapeHtml(p.model||p.product)+'</h3>'+
      '<div class="planmeta">'+escapeHtml(p.date)+' · '+escapeHtml(p.shift)+'<br>Target: '+p.qty+' units · '+p.actual+' actual · '+p.rejection+' rejected<br>'+
      escapeHtml(formatTime12(p.start))+'–'+escapeHtml(formatTime12(p.end))+' · '+escapeHtml(p.supervisor||'Unassigned')+
      (breakText?'<br><span class="plan-break-visible">Breaks: '+escapeHtml(breakText)+'</span>':'')+'</div>'+
      '<div class="planbottom"><span class="pill '+(p.status==='Draft'?'warn':'')+'">'+escapeHtml(p.status)+'</span><div class="filters">'+
      '<button class="btn" onclick="viewPlan(\''+p.id+'\')">View</button>'+
      (p.status==='Draft'?'<button class="btn" onclick="editPlan(\''+p.id+'\')">Edit</button><button class="btn primary" onclick="publishPlan(\''+p.id+'\')">Publish</button>':'')+
      '</div></div></div>';
  }).join('')||'<div class="panel"><div class="sub">No production plans have been created yet.</div></div>';
}
function renderOperator(){
  var el=document.getElementById('operatorplans');if(!el)return;
  var today=todayLocalDate();
  var visible=plans.filter(function(p){return p.status==='Published'&&p.date===today;});
  el.innerHTML=visible.map(function(p){
    var percentage=Math.round(p.qty?p.actual/p.qty*100:0);
    var breakText=(p.breakTimes||[]).map(function(x){
      return formatTime12(x.start_time||x.start)+'–'+formatTime12(x.end_time||x.end);
    }).join(', ');
    return '<div class="plan"><h3>'+escapeHtml(p.line)+' · '+escapeHtml(p.brand||'Unbranded')+' · '+escapeHtml(p.product)+' · '+escapeHtml(p.model||p.product)+'</h3>'+
      '<div class="planmeta">'+escapeHtml(p.date)+' · '+escapeHtml(p.shift)+'<br>Target: '+p.qty+' units · '+escapeHtml(formatTime12(p.start))+'–'+escapeHtml(formatTime12(p.end))+
      (breakText?'<br><span class="plan-break-visible">Breaks: '+escapeHtml(breakText)+'</span>':'')+'</div>'+
      '<div class="progress"><i style="width:'+Math.min(100,percentage)+'%"></i></div>'+
      '<div class="linemeta"><span>'+p.actual+' / '+p.qty+' units · Rejected '+p.rejection+'</span><span>'+percentage+'%</span></div>'+
      '<div class="planbottom"><span class="pill">Published</span><button class="btn primary" onclick="openExecution(\''+p.id+'\')">Open plan</button></div></div>';
  }).join('')||'<div class="panel"><div class="sub">No published production plans are scheduled for today ('+today+').</div></div>';
}

function isHourlyEntrySaved(entry){
  return !!entry&&Object.prototype.hasOwnProperty.call(entry,'actual');
}
function hourCards(p){
  var targets=planHourTargets(p),labels=p.hourLabels||timeSlots(p.start,p.end);
  var admin=!!window.pmCanEditSavedHours;
  return targets.map(function(target,i){
    var label=labels[i]||hours[i]||('Hour '+(i+1)),entry=p.entries&&p.entries[i],saved=isHourlyEntrySaved(entry);
    var q=Number(entry&&entry.actual)||0,r=Number(entry&&entry.rejected)||0,missing=Number(entry&&entry.missingSerialQty)||0;
    var canOpen=saved?admin:p.status!=='Completed';
    var cls='hour '+(saved?'recorded':'pending')+(saved&&!admin?' locked':'')+(saved&&admin?' admin-editable':'');
    var action=saved?(admin?'Updated / Edit':'Updated'):'Record hour';
    return '<div class="'+cls+'"><strong>'+escapeHtml(label)+'</strong><small>Plan: '+target+' units</small>'+
      '<div class="actual">'+(saved?q+' produced':'—')+'</div>'+
      '<small>'+(saved?r+' rejected · '+(q-r)+' accepted':'Pending')+'</small>'+
      (missing?'<small>Missing serial labels: '+missing+'</small>':'')+
      '<small class="hour-status">'+(saved?'✓ Updated':'Not recorded')+'</small>'+
      '<button class="btn" style="margin-top:10px;width:100%" '+(canOpen?'':'disabled')+
      ' title="'+(saved&&!admin?'Only an admin or super administrator can edit a saved hour':'')+
      '" onclick="hourEntry(\''+p.id+'\','+i+')">'+action+'</button></div>';
  }).join('');
}
function closeExecution(id){
  var panel=document.getElementById('execution');
  if(panel)panel.classList.add('hidden');
  var plansList=document.getElementById('operatorplans');
  if(plansList)plansList.scrollIntoView({behavior:'smooth',block:'start'});
}
function openExecution(id){
  var p=plans.find(function(x){return String(x.id)===String(id);});if(!p)return;
  var labels=p.hourLabels||timeSlots(p.start,p.end),allRecorded=planHourTargets(p).every(function(_,i){return isHourlyEntrySaved(p.entries&&p.entries[i]);});
  var admin=!!window.pmCanEditSavedHours,safeId=String(p.id);
  var content='<div class="panel execution-panel"><div class="pagehead execution-header"><div>'+
    '<h2 style="margin:0 0 5px;font-size:18px">'+escapeHtml(p.line)+' · '+escapeHtml(p.brand)+' · '+escapeHtml(p.product)+' · '+escapeHtml(p.model||'—')+'</h2>'+
    '<div class="sub">'+escapeHtml(p.date)+' · '+escapeHtml(p.shift)+' · Plan '+p.qty+' units · '+escapeHtml(formatTime12(p.start))+'–'+escapeHtml(formatTime12(p.end))+'</div></div>'+
    '<button class="btn execution-back" type="button" onclick="closeExecution(\''+safeId+'\')">← Back to plans</button></div>'+
    '<div class="detailgrid"><div class="detailbox"><div class="klabel">Planned</div><div class="num">'+p.qty+'</div></div>'+
    '<div class="detailbox"><div class="klabel">Actual recorded</div><div class="num">'+p.actual+'</div></div>'+
    '<div class="detailbox"><div class="klabel">Accepted · Rejected</div><div class="num">'+(p.actual-p.rejection)+' · '+p.rejection+'</div></div></div>'+
    '<div class="paneltitle"><h3>Hourly Production Entries</h3><span>'+(admin?'Saved hours may be corrected by Admin or Super Admin':'Saved hours are locked after submission')+'</span></div>'+
    '<div class="hourgrid">'+hourCards(p)+'</div>'+
    '<div class="paneltitle" style="margin-top:18px"><h3>Shift Closing</h3><span>'+(allRecorded?'All scheduled hourly intervals completed':'Record every scheduled interval to enable closing')+'</span></div>'+
    '<div class="detailgrid"><div class="detailbox"><div class="klabel">Total actual</div><div class="num">'+p.actual+'</div></div>'+
    '<div class="detailbox"><div class="klabel">Total rejected</div><div class="num">'+p.rejection+'</div></div>'+
    '<div class="detailbox"><div class="klabel">Accepted</div><div class="num">'+(p.actual-p.rejection)+'</div></div></div>'+
    '<div class="modalactions"><button class="btn primary" '+(allRecorded&&p.status!=='Completed'?'':'disabled')+' onclick="closeShift(\''+safeId+'\')">Close Shift</button></div></div>';
  var host=document.getElementById('execution');host.innerHTML=content;host.classList.remove('hidden');
  host.scrollIntoView({behavior:'smooth',block:'start'});
}
function hourEntry(id,h){
  var p=plans.find(function(x){return String(x.id)===String(id);});
  if(!p)return toast('Production plan not found');
  var entry=(p.entries&&p.entries[h])||{},saved=isHourlyEntrySaved(entry),admin=!!window.pmCanEditSavedHours;
  if(saved&&!admin)return toast('This hourly record is locked. Admin or Super Admin access is required to edit it.');
  if(!saved&&p.status!=='Published')return toast('Hourly production can only be recorded against a published plan.');

  var labels=p.hourLabels||timeSlots(p.start,p.end),label=labels[h]||'Hourly interval';
  var serialPairs=Array.isArray(entry.serialExceptions)?entry.serialExceptions.map(function(x){
    return {missing_serial_number:x.missing_serial_number||'',alternate_serial_number:x.alternate_serial_number||''};
  }):[];
  window.pmHourlyEntryDraft={
    id:String(id),hourIndex:h,saved:saved,previous:entry,
    serialPairs:serialPairs
  };

  var modal=document.getElementById('modal');
  var options=['IQC Rejection','LQC Rejection'].map(function(x){
    return '<option value="'+x+'" '+(entry.reason===x?'selected':'')+'>'+x+'</option>';
  }).join('');

  modal.innerHTML='<div class="modal hourly-entry-modal hourly-entry-wizard">'+
    '<div class="hourly-modal-heading"><div><h2>'+(saved?'Correct hourly production':'Record hourly production')+'</h2>'+
      '<div class="sub">'+escapeHtml(p.line)+' · '+escapeHtml(p.product)+' · '+escapeHtml(label)+'</div></div>'+
      (saved?'<span class="hourly-admin-badge">Admin edit</span>':'')+'</div>'+
    '<div class="hourly-admin-note">'+(saved?'Admin correction mode. Operators cannot change this saved entry.':'Complete the hourly production details. Once saved, the record is locked for operators.')+'</div>'+
    '<section id="hourlyInitialStep">'+
      '<div class="hourly-entry-grid">'+
        '<div class="field"><label>Planned quantity</label><input value="'+planHourTargets(p)[h]+'" disabled/></div>'+
        '<div class="field"><label>Actual quantity</label><input id="ha" type="number" min="0" inputmode="numeric" value="'+(entry.actual==null?'':entry.actual)+'" placeholder="Actual produced"/></div>'+
        '<div class="field"><label>Rejected quantity</label><input id="hr" type="number" min="0" inputmode="numeric" value="'+(entry.rejected==null?0:entry.rejected)+'" placeholder="0"/></div>'+
        '<div class="field"><label>Rejection category</label><select id="hreason"><option value="">Select IQC / LQC</option>'+options+'</select></div>'+
        '<div class="field"><label>Starting serial number</label><input id="hs" value="'+escapeHtml(entry.startSerial||'')+'" placeholder="First production serial"/></div>'+
        '<div class="field"><label>Ending serial number</label><input id="he" value="'+escapeHtml(entry.endSerial||'')+'" placeholder="Last production serial"/></div>'+
        '<div class="field"><label>Missing / damaged sticker quantity</label><input id="hmissqty" type="number" min="0" inputmode="numeric" value="'+(entry.missingSerialQty||0)+'" placeholder="0"/></div>'+
      '</div>'+
      '<div class="hourly-flow-hint">Enter the normal serial range first. If any serial stickers are missing or damaged, enter the quantity and continue to record each missing serial and its replacement.</div>'+
      '<div class="modalactions hourly-step-actions"><button class="btn" type="button" onclick="closePlanModal()">← Back to plan</button>'+
        '<button class="btn primary" type="button" onclick="continueHourlyEntry()">Continue</button></div>'+
    '</section>'+
    '<section id="hourlyFinalStep" hidden>'+
      '<div class="hourly-serial-summary" id="hourlySerialSummary">No missing serial stickers recorded.</div>'+
      '<div class="field"><label for="hrm">Remarks <span class="hourly-optional">(Optional)</span></label><textarea id="hrm" rows="3" placeholder="Add any production remarks, or leave blank">'+escapeHtml(entry.remarks||'')+'</textarea></div>'+
      '<div class="modalactions hourly-step-actions"><button class="btn" type="button" onclick="backToHourlyEntry()">← Back</button>'+
        '<button class="btn primary" type="button" onclick="submitHour(\''+String(p.id)+'\','+h+')">'+(saved?'Save correction':'Save hourly record')+'</button></div>'+
    '</section>'+
    '<div id="hourlySerialPopupHost"></div>'+
  '</div>';
  modal.classList.remove('hidden');
}

function continueHourlyEntry(){
  var draft=window.pmHourlyEntryDraft;if(!draft)return;
  var p=plans.find(function(x){return String(x.id)===draft.id;});if(!p)return;
  var q=Number(document.getElementById('ha').value||0);
  var rejected=Number(document.getElementById('hr').value||0);
  var serialStart=document.getElementById('hs').value.trim();
  var serialEnd=document.getElementById('he').value.trim();
  var reason=document.getElementById('hreason').value;
  var missingQty=Number(document.getElementById('hmissqty').value||0);
  if(!Number.isInteger(q)||q<0||!Number.isInteger(rejected)||rejected<0||rejected>q)return toast('Rejected quantity must be a whole number between zero and actual quantity.');
  if(q>planHourTargets(p)[draft.hourIndex])return toast('Actual quantity cannot exceed the planned quantity for this hour.');
  if(q>0&&(!serialStart||!serialEnd))return toast('Enter the starting and ending production serial numbers.');
  if(rejected>0&&!['IQC Rejection','LQC Rejection'].includes(reason))return toast('Choose IQC Rejection or LQC Rejection.');
  if(rejected===0)document.getElementById('hreason').value='';
  if(!Number.isInteger(missingQty)||missingQty<0||missingQty>q)return toast('Missing sticker quantity must be a whole number between zero and actual quantity.');
  draft.actualQty=q;draft.rejectedQty=rejected;draft.serialStart=serialStart;draft.serialEnd=serialEnd;
  draft.rejectionReason=rejected?reason:null;draft.missingQty=missingQty;

  if(missingQty>0){
    openHourlySerialPopup(missingQty,draft.serialPairs||[]);
    return;
  }
  draft.serialPairs=[];
  showHourlyFinalStep();
}

function openHourlySerialPopup(quantity,existing){
  var host=document.getElementById('hourlySerialPopupHost');if(!host)return;
  var rows=Array.from({length:quantity},function(_,i){
    var pair=existing[i]||{};
    return '<div class="hourly-serial-pair-row">'+
      '<div class="hourly-serial-pair-index">Missing sticker '+(i+1)+'</div>'+
      '<div class="hourly-serial-pair-fields">'+
        '<div class="field"><label>Missing serial number</label><input class="pm-missing-serial" data-index="'+i+'" value="'+escapeHtml(pair.missing_serial_number||'')+'" placeholder="Enter missing serial"/></div>'+
        '<div class="field"><label>Replacement serial number</label><input class="pm-alternate-serial" data-index="'+i+'" value="'+escapeHtml(pair.alternate_serial_number||'')+'" placeholder="Enter replacement serial"/></div>'+
      '</div></div>';
  }).join('');
  host.innerHTML='<div class="hourly-serial-popup-overlay"><section class="hourly-serial-popup" role="dialog" aria-modal="true" aria-labelledby="hourlySerialPopupTitle">'+
    '<div class="hourly-serial-popup-head"><div><h3 id="hourlySerialPopupTitle">Missing & replacement serials</h3><p>Enter one missing sticker number and its replacement for each affected unit.</p></div><span class="hourly-admin-badge">'+quantity+' units</span></div>'+
    '<div class="hourly-serial-pairs">'+rows+'</div>'+
    '<div class="modalactions hourly-serial-popup-actions"><button class="btn" type="button" onclick="cancelHourlySerialPopup()">Cancel</button><button class="btn primary" type="button" onclick="saveHourlySerialMappings()">Save serial details</button></div>'+
    '</section></div>';
  var first=host.querySelector('.pm-missing-serial');if(first)first.focus({preventScroll:true});
}

function cancelHourlySerialPopup(){
  var host=document.getElementById('hourlySerialPopupHost');if(host)host.innerHTML='';
}

function saveHourlySerialMappings(){
  var draft=window.pmHourlyEntryDraft;if(!draft)return;
  var missing=Array.from(document.querySelectorAll('.pm-missing-serial'));
  var alternate=Array.from(document.querySelectorAll('.pm-alternate-serial'));
  var pairs=missing.map(function(input,i){
    return {
      missing_serial_number:input.value.trim(),
      alternate_serial_number:alternate[i]?.value.trim()||''
    };
  });
  if(pairs.length!==draft.missingQty)return toast('Enter a serial pair for every missing sticker.');
  if(pairs.some(function(pair){return !pair.missing_serial_number||!pair.alternate_serial_number;}))return toast('Complete both serial numbers for every missing sticker.');
  var missingNumbers=pairs.map(function(x){return x.missing_serial_number.toLocaleLowerCase();});
  var alternateNumbers=pairs.map(function(x){return x.alternate_serial_number.toLocaleLowerCase();});
  if(new Set(missingNumbers).size!==missingNumbers.length)return toast('A missing serial number cannot be entered more than once.');
  if(new Set(alternateNumbers).size!==alternateNumbers.length)return toast('A replacement serial number cannot be used more than once.');
  if(pairs.some(function(x){return missingNumbers.includes(x.alternate_serial_number.toLocaleLowerCase());}))return toast('A replacement serial number cannot duplicate a missing serial number.');
  draft.serialPairs=pairs;
  cancelHourlySerialPopup();
  showHourlyFinalStep();
}

function showHourlyFinalStep(){
  var first=document.getElementById('hourlyInitialStep'),final=document.getElementById('hourlyFinalStep');
  if(first)first.hidden=true;
  if(final)final.hidden=false;
  var summary=document.getElementById('hourlySerialSummary'),draft=window.pmHourlyEntryDraft;
  if(summary){
    var pairs=draft?.serialPairs||[];
    summary.innerHTML=pairs.length
      ?'<strong>'+pairs.length+' serial replacement'+(pairs.length===1?'':'s')+' recorded</strong><div class="hourly-serial-summary-list">'+pairs.map(function(x,i){return '<span><small>#'+(i+1)+'</small>'+escapeHtml(x.missing_serial_number)+' <b>→</b> '+escapeHtml(x.alternate_serial_number)+'</span>';}).join('')+'</div>'
      :'<strong>No missing serial stickers</strong><span>Normal serial range will be saved.</span>';
  }
}

function backToHourlyEntry(){
  var first=document.getElementById('hourlyInitialStep'),final=document.getElementById('hourlyFinalStep');
  if(final)final.hidden=true;if(first)first.hidden=false;
}

async function submitHour(id,h){
  var p=plans.find(function(x){return String(x.id)===String(id);});if(!p)return toast('Production plan not found');
  var draft=window.pmHourlyEntryDraft;
  if(!draft||draft.id!==String(id)||draft.hourIndex!==h)return toast('Hourly entry details were lost. Please reopen the hour.');
  var previous=(p.entries&&p.entries[h])||{},alreadySaved=isHourlyEntrySaved(previous),admin=!!window.pmCanEditSavedHours;
  if(alreadySaved&&!admin)return toast('This hourly record is locked. Admin or Super Admin access is required to edit it.');
  if(!alreadySaved&&p.status!=='Published')return toast('Hourly production can only be recorded against a published plan.');

  var q=Number(draft.actualQty)||0,rejected=Number(draft.rejectedQty)||0;
  var serialStart=draft.serialStart||'',serialEnd=draft.serialEnd||'';
  var reason=draft.rejectionReason||null,missingQty=Number(draft.missingQty)||0;
  var pairs=Array.isArray(draft.serialPairs)?draft.serialPairs:[];
  var remarks=document.getElementById('hrm')?.value.trim()||'';

  if(q<0||rejected<0||rejected>q)return toast('Rejected quantity must be between zero and actual produced quantity.');
  if(missingQty<0||missingQty>q)return toast('Missing sticker quantity must be between zero and actual produced quantity.');
  if(q>planHourTargets(p)[h])return toast('Actual produced quantity cannot exceed the planned quantity for this hour.');
  if(q>0&&(!serialStart||!serialEnd))return toast('Enter the normal serial range.');
  if(rejected>0&&!['IQC Rejection','LQC Rejection'].includes(reason))return toast('Choose IQC Rejection or LQC Rejection.');
  if(pairs.length!==missingQty)return toast('Enter the missing and replacement serial numbers first.');
  if(pairs.some(function(x){return !x.missing_serial_number||!x.alternate_serial_number;}))return toast('Complete every missing / replacement serial pair.');

  if(alreadySaved){
    var resolved=normalizeReworkItems(previous).filter(function(unit){return unit.status!=='Pending';}).length;
    if(rejected<resolved)return toast('Rejected quantity cannot be reduced below '+resolved+'; those units already have a saved final disposition.');
    if(!previous.dbId)return toast('This saved entry has no database ID. Refresh before editing.');
  }

  var button=document.querySelector('#modal .hourly-entry-modal .modalactions .btn.primary');
  if(button){button.disabled=true;button.textContent='Saving…';}
  try{
    var values={
      actual_qty:q,rejected_qty:rejected,
      serial_start:serialStart||null,serial_end:serialEnd||null,
      rejection_reason:reason,remarks:remarks,
      missing_serial_qty:missingQty,
      missing_serial_start:missingQty?pairs[0].missing_serial_number:null,
      missing_serial_end:missingQty?pairs[pairs.length-1].missing_serial_number:null,
      alternate_serial_start:missingQty?pairs[0].alternate_serial_number:null,
      alternate_serial_end:missingQty?pairs[pairs.length-1].alternate_serial_number:null,
      serial_exceptions:pairs
    };
    var db=pmRequireDb(),result;
    if(alreadySaved){
      result=await db.from('pm_hourly_production').update(values).eq('id',previous.dbId).select('id').single();
    }else{
      result=await db.from('pm_hourly_production').insert({
        plan_id:p.id,hour_index:h,...values,recorded_by:window.pmCurrentUserId
      }).select('id').single();
    }
    if(result.error)throw result.error;
    closePlanModal();window.pmHourlyEntryDraft=null;
    await pmReloadProductionData();openExecution(id);
    toast(alreadySaved?'Hourly correction saved to Supabase':'Hourly production saved to Supabase and locked');
  }catch(error){
    toast('Could not save hourly production: '+error.message);
    if(button){button.disabled=false;button.textContent=alreadySaved?'Save correction':'Save hourly record';}
  }
}

async function closeShift(id){
  const p=plans.find(x=>String(x.id)===String(id));
  if(!p)return toast('Production plan not found');
  if(!planHourTargets(p).every((_,i)=>!!p.entries?.[i])){
    toast('Record all scheduled hourly intervals before closing shift');return;
  }
  try{
    const result=await pmRequireDb().rpc('pm_close_plan',{p_plan_id:id});
    if(result.error)throw result.error;
    const execution=document.getElementById('execution');
    if(execution)execution.classList.add('hidden');
    await pmReloadProductionData();
    toast('Shift closed in Supabase');
  }catch(error){toast('Could not close shift: '+error.message);}
}

function parseTime24(value){
  var raw=String(value||'').trim().toUpperCase();
  if(!raw)return null;
  if(/^\d{1,2}:\d{2}:\d{2}$/.test(raw))raw=raw.slice(0,5);
  var m=raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  var hour,minute;
  if(m){
    hour=Number(m[1]);minute=Number(m[2]);
    if(hour<1||hour>12||minute<0||minute>59)return null;
    if(m[3]==='AM'&&hour===12)hour=0;
    else if(m[3]==='PM'&&hour!==12)hour+=12;
  }else{
    m=raw.match(/^(\d{1,2}):(\d{2})$/);
    if(!m)return null;
    hour=Number(m[1]);minute=Number(m[2]);
    if(hour<0||hour>23||minute<0||minute>59)return null;
  }
  return String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
}
function formatTime12(value){
  var t=parseTime24(value);if(!t)return String(value||'');
  var parts=t.split(':').map(Number),hour=parts[0],minute=parts[1];
  var suffix=hour>=12?'PM':'AM',display=hour%12||12;
  return String(display).padStart(2,'0')+':'+String(minute).padStart(2,'0')+' '+suffix;
}
function normalizePlanTimeInput(input){
  if(!input)return;
  var parsed=parseTime24(input.value);
  if(parsed)input.value=formatTime12(parsed);
}
function formatHourRange12(label){
  var parts=String(label||'').split('–');
  if(parts.length!==2)return String(label||'');
  return formatTime12(parts[0])+'–'+formatTime12(parts[1]);
}
function minuteTime24(minutes){
  var h=Math.floor(minutes/60),m=minutes%60;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}
function timeSlots(start,end,breakTimes){
  var start24=parseTime24(start),end24=parseTime24(end);
  if(!start24||!end24)return [];
  var a=start24.split(':').map(Number),b=end24.split(':').map(Number);
  var startMinutes=a[0]*60+a[1],endMinutes=b[0]*60+b[1];
  if(endMinutes<=startMinutes)return [];
  var breaks=(breakTimes||[]).map(function(item){
    var s=parseTime24(item.start_time||item.start),e=parseTime24(item.end_time||item.end);
    if(!s||!e)return null;
    var sp=s.split(':').map(Number),ep=e.split(':').map(Number);
    return {start:sp[0]*60+sp[1],end:ep[0]*60+ep[1]};
  });
  if(breaks.some(function(x){return !x||x.start>=x.end||x.start<startMinutes||x.end>endMinutes;}))return [];
  breaks.sort(function(x,y){return x.start-y.start;});
  for(var i=1;i<breaks.length;i++)if(breaks[i].start<breaks[i-1].end)return [];
  var slots=[],cursor=startMinutes;
  while(cursor<endMinutes){
    var active=breaks.find(function(x){return cursor>=x.start&&cursor<x.end;});
    if(active){cursor=active.end;continue;}
    var next=breaks.find(function(x){return x.start>cursor;});
    var finish=Math.min(cursor+60,endMinutes,next?next.start:endMinutes);
    if(finish<=cursor)return [];
    slots.push(formatTime12(minuteTime24(cursor))+'–'+formatTime12(minuteTime24(finish)));
    cursor=finish;
    if(slots.length>24)return [];
  }
  return slots;
}

function todayLocalDate(){
  var now=new Date();
  return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
}
function initializeTodayDateFilters(){
  var today=todayLocalDate();
  var overview=document.getElementById('overviewDateFilter');
  var reportFrom=document.getElementById('reportFrom');
  var reportTo=document.getElementById('reportTo');
  if(overview&&!overview.value)overview.value=today;
  if(reportFrom&&!reportFrom.value)reportFrom.value=today.slice(0,7)+'-01';
  if(reportTo&&!reportTo.value)reportTo.value=today;
}

function timePickerMarkup(prefix,value,changeAction){
  var parsed=parseTime24(value)||'09:00';
  var parts=parsed.split(':').map(Number),hour24=parts[0],minute=parts[1];
  var hour12=hour24%12||12,period=hour24>=12?'PM':'AM';
  var hoursHtml=Array.from({length:12},function(_,i){
    var h=String(i+1).padStart(2,'0');
    return '<option value="'+h+'" '+(Number(h)===hour12?'selected':'')+'>'+h+'</option>';
  }).join('');
  var minuteValues=Array.from({length:12},function(_,i){return i*5;});
  if(!minuteValues.includes(minute))minuteValues.push(minute);
  minuteValues.sort(function(a,b){return a-b;});
  var minutesHtml=minuteValues.map(function(m){
    var v=String(m).padStart(2,'0');
    return '<option value="'+v+'" '+(m===minute?'selected':'')+'>'+v+'</option>';
  }).join('');
  var onchange=changeAction||'';
  return '<div class="time-picker" role="group" aria-label="Select time">'+
    '<select id="'+prefix+'Hour" aria-label="Hour" '+(onchange?'onchange="'+onchange+'"':'')+'>'+hoursHtml+'</select>'+
    '<span class="time-separator">:</span>'+
    '<select id="'+prefix+'Minute" aria-label="Minute" '+(onchange?'onchange="'+onchange+'"':'')+'>'+minutesHtml+'</select>'+
    '<select id="'+prefix+'Period" aria-label="AM or PM" '+(onchange?'onchange="'+onchange+'"':'')+'><option '+(period==='AM'?'selected':'')+'>AM</option><option '+(period==='PM'?'selected':'')+'>PM</option></select>'+
  '</div>';
}
function getTimePickerValue(prefix){
  var h=document.getElementById(prefix+'Hour')?.value;
  var m=document.getElementById(prefix+'Minute')?.value;
  var p=document.getElementById(prefix+'Period')?.value;
  return h&&m&&p?(h+':'+m+' '+p):'';
}
function readPlanBreakTimes(){
  return Array.from(document.querySelectorAll('.plan-break-row')).map(function(row,i){
    return {
      start_time:parseTime24(getTimePickerValue('planBreak'+i+'Start')),
      end_time:parseTime24(getTimePickerValue('planBreak'+i+'End'))
    };
  });
}
function validatePlanBreakTimes(start,end,breaks){
  var s=parseTime24(start),e=parseTime24(end);
  if(!s||!e||e<=s)return 'Enter a valid start and end time first.';
  var a=s.split(':').map(Number),b=e.split(':').map(Number),minStart=a[0]*60+a[1],minEnd=b[0]*60+b[1];
  if((breaks||[]).length>6)return 'A maximum of six breaks can be added.';
  var parsed=(breaks||[]).map(function(x){
    var ss=parseTime24(x.start_time),ee=parseTime24(x.end_time);
    if(!ss||!ee)return null;
    var sp=ss.split(':').map(Number),ep=ee.split(':').map(Number);
    return {start:sp[0]*60+sp[1],end:ep[0]*60+ep[1]};
  });
  if(parsed.some(function(x){return !x||x.start>=x.end||x.start<minStart||x.end>minEnd;}))
    return 'Each break must have a valid time range within the shift.';
  parsed.sort(function(x,y){return x.start-y.start;});
  for(var i=1;i<parsed.length;i++)if(parsed[i].start<parsed[i-1].end)return 'Break timings cannot overlap.';
  return '';
}
function renderPlanBreakRows(breaks){
  var host=document.getElementById('planBreakRows');if(!host)return;
  host.innerHTML=(breaks||[]).map(function(br,i){
    return '<div class="plan-break-row" data-break-index="'+i+'">'+
      '<div class="plan-break-title"><strong>Break '+(i+1)+'</strong><button class="btn plan-break-remove" type="button" onclick="removePlanBreak('+i+')">Remove</button></div>'+
      '<div class="plan-break-fields">'+
        '<div class="field"><label>Break starts</label>'+timePickerMarkup('planBreak'+i+'Start',br.start_time||br.start||'13:00','rebuildHourlyPlan()')+'</div>'+
        '<div class="field"><label>Break ends</label>'+timePickerMarkup('planBreak'+i+'End',br.end_time||br.end||'13:30','rebuildHourlyPlan()')+'</div>'+
      '</div></div>';
  }).join('');
}
function addPlanBreak(){
  var breaks=readPlanBreakTimes();
  if(breaks.length>=6)return toast('You can add up to six breaks.');
  var start=parseTime24(getTimePickerValue('pstart')),end=parseTime24(getTimePickerValue('pend'));
  if(!start||!end||end<=start)return toast('Select the shift start and end times first.');
  var a=start.split(':').map(Number),b=end.split(':').map(Number),lo=a[0]*60+a[1],hi=b[0]*60+b[1];
  var candidate=Math.floor(((lo+hi)/2)/15)*15,chosen=null;
  for(var n=0;n<Math.ceil((hi-lo)/15);n++){
    var c=lo+((candidate-lo+n*15)%(hi-lo));
    if(c+30>hi)continue;
    var overlaps=breaks.some(function(x){
      var xs=parseTime24(x.start_time),xe=parseTime24(x.end_time);
      if(!xs||!xe)return false;
      var xp=xs.split(':').map(Number),yp=xe.split(':').map(Number);
      return c<yp[0]*60+yp[1]&&c+30>xp[0]*60+xp[1];
    });
    if(!overlaps){chosen=c;break;}
  }
  if(chosen===null)return toast('No free 30-minute break slot remains inside this shift.');
  breaks.push({start_time:minuteTime24(chosen),end_time:minuteTime24(chosen+30)});
  breaks.sort(function(x,y){return parseTime24(x.start_time).localeCompare(parseTime24(y.start_time));});
  renderPlanBreakRows(breaks);
  rebuildHourlyPlan();
}
function removePlanBreak(index){
  var breaks=readPlanBreakTimes();breaks.splice(index,1);
  renderPlanBreakRows(breaks);rebuildHourlyPlan();
}
function makeCatalogSuggestions(fieldId,values){
  var field=document.getElementById(fieldId);
  var menu=document.getElementById(fieldId+'Menu');
  if(!field||!menu)return;
  var q=field.value.trim().toLocaleLowerCase();
  var matches=(values||[]).filter(function(x){return !q||x.toLocaleLowerCase().includes(q);}).slice(0,60);
  menu.innerHTML=matches.length
    ?matches.map(function(value){return '<button type="button" class="catalog-suggestion" role="option" data-value="'+escapeHtml(value)+'">'+escapeHtml(value)+'</button>';}).join('')
    :'<div class="catalog-suggestion-empty">No match. Use + to add this item.</div>';
  menu.classList.remove('hidden');
}
function attachCatalogAutocomplete(fieldId,itemsGetter){
  var field=document.getElementById(fieldId),menu=document.getElementById(fieldId+'Menu');
  if(!field||!menu||field.dataset.autocompleteBound)return;
  field.dataset.autocompleteBound='1';
  var render=function(){makeCatalogSuggestions(fieldId,itemsGetter());};
  field.addEventListener('focus',render);
  field.addEventListener('input',render);
  field.addEventListener('keydown',function(event){
    var buttons=Array.from(menu.querySelectorAll('.catalog-suggestion'));
    if(event.key==='ArrowDown'&&buttons.length){event.preventDefault();buttons[0].focus();}
    else if(event.key==='Escape'){event.preventDefault();menu.classList.add('hidden');field.blur();}
    else if(event.key==='Enter'&&buttons.length===1){event.preventDefault();buttons[0].click();}
  });
  menu.addEventListener('mousedown',function(event){event.preventDefault();});
  menu.addEventListener('keydown',function(event){
    var buttons=Array.from(menu.querySelectorAll('.catalog-suggestion'));
    var active=buttons.findIndex(function(x){return x===document.activeElement;});
    if(event.key==='ArrowDown'&&buttons.length){event.preventDefault();buttons[Math.min(active+1,buttons.length-1)].focus();}
    else if(event.key==='ArrowUp'&&buttons.length){event.preventDefault();if(active>0)buttons[active-1].focus();else field.focus();}
    else if(event.key==='Escape'){event.preventDefault();menu.classList.add('hidden');field.focus();}
    else if(event.key==='Enter'&&active>=0){event.preventDefault();buttons[active].click();}
  });
  menu.addEventListener('click',function(event){
    var option=event.target.closest('.catalog-suggestion');if(!option)return;
    field.value=option.dataset.value||'';
    menu.classList.add('hidden');
    field.dispatchEvent(new Event('change',{bubbles:true}));
    field.blur();
  });
  field.addEventListener('blur',function(){setTimeout(function(){menu.classList.add('hidden');},80);});
}
function planForm(p=null){
  editingPlanId=p?.id??null;
  var modal=document.getElementById('modal');
  var start24=parseTime24(p?.start||'09:00')||'09:00';
  var end24=parseTime24(p?.end||'17:00')||'17:00';
  var breaks=Array.isArray(p?.breakTimes)?p.breakTimes:[];
  var slots=timeSlots(start24,end24,breaks);
  var targets=Array.isArray(p?.hourTargets)?p.hourTargets:slots.map(function(){return 0;});
  if(!slots.length)return toast('Choose valid shift times and break timings.');
  modal.classList.remove('modalback-rework');
  modal.innerHTML='<div class="modal plan-form-modal"><div class="plan-form-scroll"><h2>'+(p?'Edit Production Plan':'Create Production Plan')+'</h2>'+
    '<div class="formgrid plan-main-fields">'+
      '<div class="field"><label for="pdate">Production date</label><input id="pdate" type="date" value="'+escapeHtml(p?.date||todayLocalDate())+'" required/></div>'+
      '<div class="field"><label for="pshift">Shift</label><select id="pshift" required>'+['Shift 1','Shift 2','Shift 3'].map(function(x){return '<option '+(p?.shift===x?'selected':'')+'>'+x+'</option>';}).join('')+'</select></div>'+
      '<div class="field"><label for="pline">Production line</label><select id="pline" required>'+['Line 1','Line 2','Line 3'].map(function(x){return '<option '+(p?.line===x?'selected':'')+'>'+x+'</option>';}).join('')+'</select></div>'+
      '<div class="field"><label for="pbrand">Brand</label><div class="catalog-input-shell"><div class="select-action-wrap"><input id="pbrand" class="select catalog-autocomplete" placeholder="Search or select brand" autocomplete="off" value="'+escapeHtml(p?.brand||'')+'" required/><button class="select-add" type="button" title="Add brand" aria-label="Add brand" onclick="addBrandInline()">＋</button></div><div id="pbrandMenu" class="catalog-suggestion-menu hidden" role="listbox"></div></div></div>'+
      '<div class="field"><label for="pproduct">Product</label><div class="catalog-input-shell"><div class="select-action-wrap"><input id="pproduct" class="select catalog-autocomplete" placeholder="Search or select product" autocomplete="off" value="'+escapeHtml(p?.product||'')+'" required/><button class="select-add" type="button" title="Add product" aria-label="Add product" onclick="addProductInline()">＋</button></div><div id="pproductMenu" class="catalog-suggestion-menu hidden" role="listbox"></div></div></div>'+
      '<div class="field"><label for="pmodel">Model number</label><div class="catalog-input-shell"><div class="select-action-wrap"><input id="pmodel" class="select catalog-autocomplete" placeholder="Search or select model number" autocomplete="off" value="'+escapeHtml(p?.model||'')+'" required/><button class="select-add" type="button" title="Add model number" aria-label="Add model number" onclick="addModelInline()">＋</button></div><div id="pmodelMenu" class="catalog-suggestion-menu hidden" role="listbox"></div></div></div>'+
      '<div class="field"><label>Start time</label>'+timePickerMarkup('pstart',start24,'rebuildHourlyPlan()')+'</div>'+
      '<div class="field"><label>End time</label>'+timePickerMarkup('pend',end24,'rebuildHourlyPlan()')+'</div>'+
      '<div class="field"><label for="psuper">Supervisor</label><input id="psuper" value="'+escapeHtml(p?.supervisor||'')+'" placeholder="Supervisor name"/></div>'+
    '</div>'+
    '<div class="panel plan-break-panel"><div class="paneltitle"><div><h3>Break timings</h3><small>Breaks are excluded from hourly production targets.</small></div><button class="btn plan-break-add" type="button" onclick="addPlanBreak()">＋ Add break</button></div>'+
      '<div id="planBreakRows">'+breaks.map(function(br,i){return '<div class="plan-break-row" data-break-index="'+i+'"><div class="plan-break-title"><strong>Break '+(i+1)+'</strong><button class="btn plan-break-remove" type="button" onclick="removePlanBreak('+i+')">Remove</button></div><div class="plan-break-fields"><div class="field"><label>Break starts</label>'+timePickerMarkup('planBreak'+i+'Start',br.start_time||br.start,'rebuildHourlyPlan()')+'</div><div class="field"><label>Break ends</label>'+timePickerMarkup('planBreak'+i+'End',br.end_time||br.end,'rebuildHourlyPlan()')+'</div></div></div>';}).join('')+'</div>'+
      '<div class="plan-break-empty '+(breaks.length?'hidden':'')+'" id="planBreakEmpty">No breaks added. Select Add break to schedule tea, lunch or other breaks.</div></div>'+
    '<div class="panel plan-hour-panel"><div class="paneltitle"><h3>Hourly planned quantity</h3><span id="planIntervalCount">'+slots.length+' working intervals</span></div>'+
      '<div class="field plan-default-qty"><label for="defaultHourlyQty">Default planned quantity for every interval</label><input id="defaultHourlyQty" type="number" min="0" inputmode="numeric" value="'+(targets.length?Number(targets[0])||0:0)+'" placeholder="Enter hourly target" oninput="fillAllHourlyTargets(this.value)"/>'+
      '<small>Break periods are skipped automatically. The last interval can be shorter than one hour.</small></div>'+
      '<div id="hourtargetfields" class="hourly-target-grid">'+slots.map(function(slot,i){return '<div class="field"><label>'+escapeHtml(slot)+'</label><input class="targetqty" type="number" min="0" inputmode="numeric" value="'+(Number(targets[i])||0)+'"/></div>';}).join('')+'</div>'+
      '<div class="plan-total-row">Total shift plan: <strong id="planTotal">'+targets.reduce(function(a,b){return a+(Number(b)||0);},0)+'</strong> units</div></div>'+
    '</div><div class="plan-form-footer"><button class="btn" type="button" onclick="closePlanModal()">Cancel</button><button class="btn primary" type="button" onclick="savePlan()">'+(p?'Save changes':'Save plan')+'</button></div></div>';

  attachCatalogAutocomplete('pbrand',function(){return pmBrandNames;});
  attachCatalogAutocomplete('pproduct',function(){return pmProductNames;});
  attachCatalogAutocomplete('pmodel',function(){return pmModelNumbers;});
  updatePlanProducts(p?.product||'');updatePlanModels(p?.model||'');
  document.querySelectorAll('.targetqty').forEach(function(x){x.addEventListener('input',updatePlanTotal);});
  updatePlanTotal();modal.classList.remove('hidden');
}
function pModelLookup(b,x){return productModels[b+'|'+x]||'';}function openPlanModal(){planForm();}function editPlan(id){planForm(plans.find(function(x){return String(x.id)===String(id);}));}function updatePlanProducts(selected){
  var field=document.getElementById('pproduct');
  if(field&&selected){field.value=selected;field.dispatchEvent(new Event('input',{bubbles:true}));}
}function updatePlanModels(selected){
  var field=document.getElementById('pmodel');
  if(field&&selected){field.value=selected;field.dispatchEvent(new Event('input',{bubbles:true}));}
}
function updatePlanTotal(){let total=[...document.querySelectorAll('.targetqty')].reduce((sum,x)=>sum+Math.max(0,Number(x.value)||0),0);let el=document.getElementById('planTotal');if(el)el.textContent=total;}function fillAllHourlyTargets(value){let qty=Math.max(0,Number(value)||0);document.querySelectorAll('.targetqty').forEach(x=>x.value=qty);updatePlanTotal();}
function rebuildHourlyPlan(){
  var start=parseTime24(getTimePickerValue('pstart'));
  var end=parseTime24(getTimePickerValue('pend'));
  var breaks=readPlanBreakTimes();
  var container=document.getElementById('hourtargetfields');
  if(!container)return;
  var error=validatePlanBreakTimes(start,end,breaks);
  if(error){
    container.innerHTML='<div class="sub plan-time-warning">'+escapeHtml(error)+'</div>';
    var total=document.getElementById('planTotal');if(total)total.textContent='—';
    return;
  }
  var slots=timeSlots(start,end,breaks);
  if(!slots.length||slots.length>24){toast('The shift must contain between one and 24 working intervals.');return;}
  var previous={};
  Array.from(container.querySelectorAll('.field')).forEach(function(field){
    var label=field.querySelector('label')?.textContent;
    var input=field.querySelector('.targetqty');
    if(label&&input)previous[label]=Math.max(0,Number(input.value)||0);
  });
  var defaultQty=Math.max(0,Number(document.getElementById('defaultHourlyQty')?.value)||0);
  container.className='hourly-target-grid';
  container.innerHTML=slots.map(function(slot){
    var value=Object.prototype.hasOwnProperty.call(previous,slot)?previous[slot]:defaultQty;
    return '<div class="field"><label>'+escapeHtml(slot)+'</label><input class="targetqty" type="number" min="0" inputmode="numeric" value="'+value+'"/></div>';
  }).join('');
  container.querySelectorAll('.targetqty').forEach(function(x){x.addEventListener('input',updatePlanTotal);});
  var count=document.getElementById('planIntervalCount');if(count)count.textContent=slots.length+' working intervals';
  var empty=document.getElementById('planBreakEmpty');if(empty)empty.classList.toggle('hidden',breaks.length>0);
  updatePlanTotal();
}

async function savePlan(){
  var button=document.querySelector('#modal .plan-form-footer .btn.primary');
  if(button){button.disabled=true;button.textContent='Saving…';}
  try{
    var brand=document.getElementById('pbrand').value.trim();
    var product=document.getElementById('pproduct').value.trim();
    var model=document.getElementById('pmodel').value.trim();
    var date=document.getElementById('pdate').value;
    var shift=document.getElementById('pshift').value;
    var line=document.getElementById('pline').value;
    var start=parseTime24(getTimePickerValue('pstart'));
    var end=parseTime24(getTimePickerValue('pend'));
    var breaks=readPlanBreakTimes();
    var supervisor=document.getElementById('psuper').value.trim();
    var targets=Array.from(document.querySelectorAll('.targetqty')).map(function(x){return Math.max(0,Number(x.value)||0);});
    var slots=start&&end?timeSlots(start,end,breaks):[];
    var qty=targets.reduce(function(a,b){return a+b;},0);
    var catalogHas=function(value,list){return list.some(function(item){return String(item).trim().toLocaleLowerCase()===String(value).trim().toLocaleLowerCase();});};
    if(!date||!brand||!product||!model||qty<=0){toast('Select production date, brand, product, model and hourly quantities');return;}
    if(!catalogHas(brand,pmBrandNames)||!catalogHas(product,pmProductNames)||!catalogHas(model,pmModelNumbers)){
      toast('Choose an available Brand, Product and Model Number, or add it using the + button.');return;
    }
    var breakError=validatePlanBreakTimes(start,end,breaks);
    if(breakError){toast(breakError);return;}
    if(!start||!end||end<=start){toast('Select a valid start and end time.');return;}
    if(slots.length<1||slots.length>24||targets.length!==slots.length){
      toast('Hourly target fields must match the working intervals after breaks (1–24).');return;
    }
    if(targets.some(function(x){return !Number.isInteger(x)||x<0;})){toast('Hourly planned quantities must be non-negative whole numbers.');return;}
    const db=pmRequireDb();
    const result=await db.rpc('pm_save_production_plan_v2',{
      p_plan_id:editingPlanId||null,p_plan_date:date,p_shift:shift,p_line:line,
      p_brand_name:brand,p_product_name:product,p_model_number:model,p_planned_qty:qty,
      p_start_time:start,p_end_time:end,p_supervisor_name:supervisor||null,
      p_hour_targets:slots.map(function(label,i){return {hour_label:label,planned_qty:targets[i]};}),
      p_break_times:breaks
    });
    if(result.error)throw result.error;
    var savedId=result.data;editingPlanId=null;closePlanModal();
    await pmReloadProductionData();toast('Production plan saved to Supabase');
    if(savedId)document.getElementById('plans')?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){toast('Could not save plan: '+error.message);}
  finally{if(button){button.disabled=false;button.textContent='Save plan';}}
}

async function publishPlan(id){
  try{
    const result=await pmRequireDb().rpc('pm_publish_plan',{p_plan_id:id});
    if(result.error)throw result.error;
    await pmReloadProductionData();
    toast('Plan published in Supabase');
  }catch(error){toast('Could not publish plan: '+error.message);}
}
function viewPlan(id){
  var p=plans.find(function(x){return String(x.id)===String(id);});if(!p)return;
  var accepted=p.actual-p.rejection,labels=p.hourLabels||timeSlots(p.start,p.end,p.breakTimes||[]);
  var breakText=(p.breakTimes||[]).map(function(x){
    return formatTime12(x.start_time||x.start)+'–'+formatTime12(x.end_time||x.end);
  }).join(', ');
  var body=planHourTargets(p).map(function(_,i){
    var e=p.entries&&p.entries[i]||{};
    return '<tr><td>'+escapeHtml(labels[i]||'Hour '+(i+1))+'</td><td>'+planHourTargets(p)[i]+'</td><td>'+getHourlyActual(p,i)+'</td><td>'+getHourlyRejected(p,i)+'</td><td>'+(getHourlyActual(p,i)-getHourlyRejected(p,i))+'</td><td>'+Number(e.missingSerialQty||0)+'</td></tr>';
  }).join('');
  var modal=document.getElementById('modal');
  modal.innerHTML='<div class="modal" style="width:min(900px,100%);max-height:90vh;overflow:auto">'+
    '<div class="paneltitle"><h2>Production Plan Details</h2><span class="pill">'+escapeHtml(p.status)+'</span></div>'+
    '<h3>'+escapeHtml(p.line)+' · '+escapeHtml(p.brand)+' · '+escapeHtml(p.product)+' · '+escapeHtml(p.model||'—')+'</h3>'+
    '<div class="sub">'+escapeHtml(p.date)+' · '+escapeHtml(p.shift)+' · '+escapeHtml(formatTime12(p.start))+'–'+escapeHtml(formatTime12(p.end))+' · '+escapeHtml(p.supervisor||'Unassigned')+
    (breakText?' · Breaks: '+escapeHtml(breakText):'')+'</div>'+
    '<div class="detailgrid"><div class="detailbox"><div class="klabel">Planned</div><div class="num">'+p.qty+'</div></div><div class="detailbox"><div class="klabel">Actual</div><div class="num">'+p.actual+'</div></div><div class="detailbox"><div class="klabel">Rejected · Accepted</div><div class="num">'+p.rejection+' · '+accepted+'</div></div></div>'+
    '<div class="panel"><div class="paneltitle"><h3>Hourly Plan & Production</h3></div><div class="report-table-scroll"><table><thead><tr><th>Hour</th><th>Plan</th><th>Actual</th><th>Rejected</th><th>Accepted</th><th>Missing serial qty</th></tr></thead><tbody>'+body+'</tbody></table></div></div>'+
    '<div class="modalactions"><button class="btn" onclick="closePlanModal()">Close</button></div></div>';
  modal.classList.remove('hidden');
}
function closePlanModal(){let modal=document.getElementById('modal');modal.classList.add('hidden');modal.classList.remove('modalback-rework');editingPlanId=null;}

async function addBrandInline(){
  var input=window.prompt('Enter new brand name');if(!input)return;
  var name=input.trim();if(!name)return;
  try{
    var db=pmRequireDb();
    var existing=await db.from('pm_brands').select('id,name').ilike('name',name).maybeSingle();
    if(existing.error)throw existing.error;
    var record=existing.data;
    if(!record){var result=await db.from('pm_brands').insert({name:name,created_by:window.pmCurrentUserId||null}).select('id,name').single();if(result.error)throw result.error;record=result.data;}
    await pmReloadProductionData();
    var field=document.getElementById('pbrand');if(field){field.value=record.name;field.dispatchEvent(new Event('change',{bubbles:true}));field.blur();}
    toast(existing.data?'Brand already exists. Selected it.':'Brand added and selected.');
  }catch(error){toast('Could not add brand: '+error.message);}
}

async function addProductInline(){
  var input=window.prompt('Enter product name');if(!input)return;
  var name=input.trim();if(!name)return;
  try{
    var db=pmRequireDb();
    var existing=await db.from('pm_products').select('id,name').ilike('name',name).maybeSingle();
    if(existing.error)throw existing.error;
    var record=existing.data;
    if(!record){var result=await db.from('pm_products').insert({brand_id:null,name:name,created_by:window.pmCurrentUserId||null}).select('id,name').single();if(result.error)throw result.error;record=result.data;}
    await pmReloadProductionData();
    var field=document.getElementById('pproduct');if(field){field.value=record.name;field.focus();field.dispatchEvent(new Event('input',{bubbles:true}));}
    toast(existing.data?'Product already exists. Selected it.':'Product added and selected. Add a model separately.');
  }catch(error){toast('Could not add product: '+error.message);}
}

async function addModelInline(){
  var input=window.prompt('Enter model number');if(!input)return;
  var name=input.trim();if(!name)return;
  try{
    var db=pmRequireDb();
    var existing=await db.from('pm_models').select('id,model_number').ilike('model_number',name).maybeSingle();
    if(existing.error)throw existing.error;
    var record=existing.data;
    if(!record){var result=await db.from('pm_models').insert({product_id:null,model_number:name,created_by:window.pmCurrentUserId||null}).select('id,model_number').single();if(result.error)throw result.error;record=result.data;}
    await pmReloadProductionData();
    var field=document.getElementById('pmodel');if(field){field.value=record.model_number;field.dispatchEvent(new Event('change',{bubbles:true}));field.blur();}
    toast(existing.data?'Model number already exists. Selected it.':'Model number added and selected.');
  }catch(error){toast('Could not add model number: '+error.message);}
}

async function closeShift(id){
  const p=plans.find(x=>String(x.id)===String(id));
  if(!p)return toast('Production plan not found');
  if(!planHourTargets(p).every((_,i)=>!!p.entries?.[i])){
    toast('Record all scheduled hourly intervals before closing shift');return;
  }
  try{
    const result=await pmRequireDb().rpc('pm_close_plan',{p_plan_id:id});
    if(result.error)throw result.error;
    const execution=document.getElementById('execution');
    if(execution)execution.classList.add('hidden');
    await pmReloadProductionData();
    toast('Shift closed in Supabase');
  }catch(error){toast('Could not close shift: '+error.message);}
}
function clearReworkDate(){const field=window.document.querySelector('#reworkDate');if(field)field.value='';renderRework();}
function normalizeReworkItems(entry){
  if(!entry||!Array.isArray(entry.reworkItems))return [];
  return entry.reworkItems;
}
function planReworkUnits(plan){
  var result=[];
  Object.keys(plan.entries||{}).map(Number).sort(function(a,b){return a-b;}).forEach(function(hourIndex){
    var entry=plan.entries[hourIndex];
    if(!entry||!(Number(entry.rejected)>0))return;
    normalizeReworkItems(entry).forEach(function(unit,unitIndex){
      result.push({
        planId:plan.id,
        hourIndex:hourIndex,
        hour:(plan.hourLabels||hours)[hourIndex]||hours[hourIndex]||('Hour '+(hourIndex+1)),
        entry:entry,
        unit:unit,
        unitIndex:unitIndex
      });
    });
  });
  return result;
}
function sumRework(plan,status){
  return planReworkUnits(plan).reduce((total,row)=>total+((row.unit.status||'Pending')===status?1:0),0);
}
function reworkSelectOptions(select,items,allLabel,selected){
  if(!select)return;
  const unique=[...new Set(items.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
  select.innerHTML=`<option value="all">${allLabel}</option>`+unique.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');
  select.value=unique.includes(selected)?selected:'all';
}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function renderRework(){
  const doc=window.document;
  const date=doc.querySelector('#reworkDate')?.value||'';
  const planStatus=doc.querySelector('#reworkPlanStatus')?.value||'all';
  const line=doc.querySelector('#reworkLine')?.value||'all';
  const brand=doc.querySelector('#reworkBrand')?.value||'all';
  const product=doc.querySelector('#reworkProduct')?.value||'all';
  const model=doc.querySelector('#reworkModel')?.value||'all';
  const shift=doc.querySelector('#reworkShift')?.value||'all';
  const resolution=doc.querySelector('#reworkResolutionStatus')?.value||'all';
  const allWithRejection=plans.filter(p=>planReworkUnits(p).length>0);
  reworkSelectOptions(doc.querySelector('#reworkLine'),allWithRejection.map(p=>p.line),'All lines',line);
  reworkSelectOptions(doc.querySelector('#reworkBrand'),allWithRejection.map(p=>p.brand),'All brands',brand);
  const brandForProducts=doc.querySelector('#reworkBrand')?.value||'all';
  reworkSelectOptions(doc.querySelector('#reworkProduct'),allWithRejection.filter(p=>brandForProducts==='all'||p.brand===brandForProducts).map(p=>p.product),'All products',product);
  const selectedProduct=doc.querySelector('#reworkProduct')?.value||'all';
  const productsForModels=allWithRejection.filter(p=>(brandForProducts==='all'||p.brand===brandForProducts)&&(selectedProduct==='all'||p.product===selectedProduct));
  reworkSelectOptions(doc.querySelector('#reworkModel'),productsForModels.map(p=>p.model),'All models',model);
  const selectedModel=doc.querySelector('#reworkModel')?.value||'all';
  reworkSelectOptions(doc.querySelector('#reworkShift'),allWithRejection.map(p=>p.shift),'All shifts',shift);
  const filtered=allWithRejection.filter(p=>{
    if(date&&p.date!==date)return false;
    if(planStatus!=='all'&&p.status!==planStatus)return false;
    if(line!=='all'&&p.line!==line)return false;
    if(brandForProducts!=='all'&&p.brand!==brandForProducts)return false;
    if(selectedProduct!=='all'&&p.product!==selectedProduct)return false;
    if(selectedModel!=='all'&&p.model!==selectedModel)return false;
    if(shift!=='all'&&p.shift!==shift)return false;
    if(resolution!=='all'&&!planReworkUnits(p).some(x=>(x.unit.status||'Pending')===resolution))return false;
    return true;
  });
  const allUnits=filtered.flatMap(planReworkUnits);
  const rejectedTotal=allUnits.length;
  const pending=allUnits.filter(x=>(x.unit.status||'Pending')==='Pending').length;
  const completed=allUnits.filter(x=>x.unit.status==='Completed').length;
  const finalRejected=allUnits.filter(x=>x.unit.status==='Finally Rejected').length;
  const k=doc.querySelector('#reworkKpis'),count=doc.querySelector('#reworkCount'),table=doc.querySelector('#reworkTable');
  if(!k||!count||!table)return;
  k.innerHTML=[['Rejected units',rejectedTotal],['Pending resolution',pending],['Rework completed',completed],['Finally rejected',finalRejected]].map(([label,value])=>`<div class="card"><div class="klabel">${label}</div><div class="kvalue">${value}</div></div>`).join('');
  count.textContent=`${filtered.length} plans · ${rejectedTotal} rejected units`;
  table.querySelector('thead').innerHTML='<tr><th>PRODUCTION</th><th>PRODUCT / MODEL</th><th>OUTPUT</th><th>REJECTED</th><th>PENDING</th><th>REWORKED</th><th>FINAL REJECT</th><th>ACTION</th></tr>';
  table.querySelector('tbody').innerHTML=filtered.map(p=>{
    const units=planReworkUnits(p),rej=units.length,pend=units.filter(x=>(x.unit.status||'Pending')==='Pending').length,done=units.filter(x=>x.unit.status==='Completed').length,final=units.filter(x=>x.unit.status==='Finally Rejected').length;
    return `<tr><td><div class="rw-production-cell"><strong>${escapeHtml(p.date||'—')}</strong><span>${escapeHtml(p.line||'—')} · ${escapeHtml(p.brand||'—')}</span><small>${escapeHtml(p.status||'—')}</small></div></td><td><div class="rw-product-cell"><strong>${escapeHtml(p.product||'—')}</strong><span>${escapeHtml(p.model||'—')}</span></div></td><td><div class="rw-output-cell"><strong>${Number(p.actual)||0}</strong><span>of ${Number(p.qty)||0} planned</span></div></td><td><span class="rw-count-pill rejected">${rej}</span></td><td><span class="rw-count-pill pending">${pend}</span></td><td><span class="rw-count-pill completed">${done}</span></td><td><span class="rw-count-pill final">${final}</span></td><td><button class="btn primary" onclick="openReworkPlan('${p.id}')">Resolve</button></td></tr>`;
  }).join('')||'<tr><td colspan="8" class="rework-empty">No rejected production matches these filters.</td></tr>'
  var advanced=document.getElementById('reworkAdvancedCount');
  if(advanced){var active=[brandForProducts!=='all',selectedProduct!=='all',selectedModel!=='all',shift!=='all'].filter(Boolean).length;advanced.textContent=active?active+' active':'Optional filters';}
}
function resetReworkFilters(){
  ['reworkDate','reworkPlanStatus','reworkLine','reworkBrand','reworkProduct','reworkModel','reworkShift','reworkResolutionStatus'].forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.value=id==='reworkDate'?'':'all';
  });
  var details=document.getElementById('reworkAdvancedFilters');
  if(details)details.open=false;
  renderRework();
}
function reworkStatusLabel(status){return status==='Completed'?'Reworked / Completed':status==='Finally Rejected'?'Finally Rejected':'Pending';}
function openReworkPlan(id){
  var p=plans.find(function(x){return String(x.id)===String(id);});
  if(!p)return;
  var rows=planReworkUnits(p);
  var pendingRows=rows.filter(function(x){return (x.unit.status||'Pending')==='Pending';});
  var resolvedRows=rows.filter(function(x){return (x.unit.status||'Pending')!=='Pending';});
  var completed=resolvedRows.filter(function(x){return x.unit.status==='Completed';}).length;
  var finalRejected=resolvedRows.filter(function(x){return x.unit.status==='Finally Rejected';}).length;
  function renderRows(list,editable){
    return list.map(function(row){
      var h=row.hourIndex,u=row.unitIndex,entry=row.entry,unit=row.unit;
      var label='Rejected unit #'+(unit.unitNumber||u+1);
      var reason=escapeHtml(unit.reason||entry.reason||'—');
      var remark=escapeHtml(unit.remark||'');
      var status=unit.status||'Pending';
      var inputId='rw-'+p.id+'-'+h+'-'+u;
      var statusCell=editable
        ?'<select class="rw-status-select" id="'+inputId+'-status"><option value="Pending" selected>Pending</option><option value="Completed">Reworked / Completed</option><option value="Finally Rejected">Finally Rejected</option></select>'
        :'<span class="rw-status-locked '+(status==='Completed'?'completed':'rejected')+'">'+reworkStatusLabel(status)+'</span>';
      var remarkCell=editable
        ?'<input class="rw-remark-input" id="'+inputId+'-remark" value="'+remark+'" placeholder="Add resolution remark">'
        :'<span class="rw-history-remark">'+(remark||'—')+'</span>';
      var action=editable
        ?'<button class="btn primary rw-save" onclick="saveReworkUnit(\''+p.id+'\','+h+','+u+')">Save</button>'
        :'<span class="rw-locked-note">Saved</span>';
      return '<tr><td>'+escapeHtml(row.hour)+'</td><td><strong>'+escapeHtml(unit.serial||label)+'</strong></td><td>'+reason+'</td><td>'+statusCell+'</td><td>'+remarkCell+'</td><td>'+action+'</td></tr>';
    }).join('');
  }
  var pendingBody=renderRows(pendingRows,true);
  var resolvedBody=renderRows(resolvedRows,false);
  var modal=document.getElementById('modal');
  modal.classList.add('modalback-rework');
  modal.innerHTML='<div class="modal rework-modal"><div class="rw-modal-header"><div><h2>Rework Resolution</h2><div class="sub">'+escapeHtml(p.line)+' · '+escapeHtml(p.brand)+' · '+escapeHtml(p.product)+' · '+escapeHtml(p.model||'—')+'</div></div><button class="btn rw-modal-close" onclick="closePlanModal()" aria-label="Close">×</button></div>'+
    '<div class="rw-plan-context">'+escapeHtml(p.date)+' · '+escapeHtml(p.shift)+' · '+escapeHtml(p.status||'—')+' <span>Planned <b>'+Number(p.qty||0)+'</b></span><span>Actual <b>'+Number(p.actual||0)+'</b></span></div>'+
    '<div class="rework-summary rw-summary-cards"><span class="rw-summary-total"><b>'+rows.length+'</b><small>Total rejected</small></span><span class="rw-summary-pending"><b>'+pendingRows.length+'</b><small>Pending</small></span><span class="rw-summary-completed"><b>'+completed+'</b><small>Reworked</small></span><span class="rw-summary-final"><b>'+finalRejected+'</b><small>Final rejected</small></span></div>'+
    '<section class="rw-pending-section"><div class="rw-section-title"><div><h3>Pending resolution</h3><p>Choose a final disposition and enter a remark for each unit.</p></div><span class="rw-pending-badge">'+pendingRows.length+' remaining</span></div>'+
    '<div class="report-table-scroll"><table class="rw-unit-table"><thead><tr><th>Hour</th><th>Unit / serial</th><th>Original reason</th><th>Disposition</th><th>Resolution remark</th><th>Save</th></tr></thead><tbody>'+
    (pendingBody||'<tr><td colspan="6" class="rework-empty">No pending rejected units. All units have been resolved.</td></tr>')+'</tbody></table></div></section>'+
    '<details class="rw-history-section"><summary><span>Resolution history</span><span class="rw-history-meta">'+resolvedRows.length+' saved · View history</span></summary><div class="report-table-scroll"><table class="rw-unit-table"><thead><tr><th>Hour</th><th>Unit / serial</th><th>Original reason</th><th>Final status</th><th>Remark</th><th></th></tr></thead><tbody>'+
    (resolvedBody||'<tr><td colspan="6" class="rework-empty">No resolved units yet.</td></tr>')+'</tbody></table></div></details>'+
    '<div class="modalactions"><button class="btn" onclick="closePlanModal()">Close</button></div></div>';
  modal.classList.remove('hidden');
}

async function saveReworkUnit(id,h,unitIndex){
  var p=plans.find(function(x){return String(x.id)===String(id);});
  var entry=p&&p.entries&&p.entries[h];
  if(!p||!entry)return toast('Production plan or hourly entry not found');
  var items=normalizeReworkItems(entry),unit=items[unitIndex];
  if(!unit)return toast('Rejected unit not found');
  if((unit.status||'Pending')!=='Pending')return toast('This rejection is already resolved and locked');
  var prefix='#rw-'+p.id+'-'+h+'-'+unitIndex;
  var status=document.querySelector(prefix+'-status')?.value||'Pending';
  var remark=document.querySelector(prefix+'-remark')?.value.trim()||'';
  if(status==='Pending')return toast('Choose Reworked / Completed or Finally Rejected to resolve this unit');
  if(status!=='Completed'&&status!=='Finally Rejected')return toast('Select a valid final status');
  if(!remark)return toast('Enter a resolution remark before resolving this rejected unit');
  if(!unit.dbId)return toast('This rejected unit has no database ID. Refresh the page before editing.');
  try{
    var dbStatus=status==='Completed'?'completed':'finally_rejected';
    var result=await pmRequireDb().from('pm_rework_units')
      .update({status:dbStatus,resolution_remark:remark})
      .eq('id',unit.dbId).eq('status','pending')
      .select('id').single();
    if(result.error)throw result.error;
    await pmReloadProductionData();
    renderReports();
    openReworkPlan(id);
    toast(status==='Completed'?'Rejected unit marked reworked in Supabase':'Rejected unit marked finally rejected in Supabase');
  }catch(error){
    toast('Could not save rework resolution: '+error.message);
  }
}
function toast(t){let x=document.getElementById('toast');x.textContent=t;x.style.display='block';setTimeout(()=>x.style.display='none',2600);}
function refreshOverview(){refreshProductOptions();renderOverviewChart();updateOverviewKpis();}

function getOverviewPlanFilters(){
  var line=document.getElementById('lineFilter')?.value||'All lines';
  var brand=document.getElementById('overviewBrandFilter')?.value||'All brands';
  var product=document.getElementById('overviewProductFilter')?.value||'All products';
  var date=document.getElementById('overviewDateFilter')?.value||'';
  var shift=document.getElementById('overviewShiftFilter')?.value||'All shifts';
  return {line:line,brand:brand,product:product,date:date,shift:shift};
}
function overviewPlanMatches(p){
  var f=getOverviewPlanFilters();
  return (!f.date||p.date===f.date)&&(f.shift==='All shifts'||p.shift===f.shift)&&
    (f.line==='All lines'||p.line===f.line)&&(f.brand==='All brands'||p.brand===f.brand)&&
    (f.product==='All products'||p.product===f.product);
}
function getOverviewPlans(){return plans.filter(function(p){return p.status==='Published'&&overviewPlanMatches(p);});}
function getOverviewStatusPlans(){
  return plans.filter(function(p){return overviewPlanMatches(p);})
    .sort(function(a,b){return String(a.date).localeCompare(String(b.date))||String(a.line).localeCompare(String(b.line));});
}
function getPlanStatusLabel(p){
  if(p.status==='Draft')return 'Draft';
  if(p.status==='Completed')return 'Completed';
  return Number(p.actual)>0?'In Progress':'Published';
}
function updateOverviewKpis(){
  var f=getOverviewPlans(),planned=f.reduce(function(a,p){return a+(Number(p.qty)||0);},0);
  var actual=f.reduce(function(a,p){return a+(Number(p.actual)||0);},0);
  var rej=f.reduce(function(a,p){return a+(Number(p.rejection)||0);},0);
  var cards=document.querySelectorAll('#overview .cards .card');
  if(cards.length>=4){
    cards[0].querySelector('.kvalue').textContent=planned;
    cards[0].querySelector('.kfoot').textContent='Units across '+new Set(f.map(function(p){return p.line;})).size+' active lines';
    cards[1].querySelector('.kvalue').textContent=actual;
    cards[1].querySelector('.kfoot').textContent=(planned?Math.round(actual/planned*100):0)+'% of filtered target';
    cards[2].querySelector('.kvalue').textContent=Math.max(0,planned-actual);
    cards[3].querySelector('.kvalue').textContent=rej;
    cards[3].querySelector('.kfoot').textContent='Hourly rejection totals';
  }
  renderOverviewSummary(f);renderOverviewPlanStatusCards();
}
function renderOverviewPlanStatusCards(){
  var host=document.getElementById('overviewPlanStatusCards'),count=document.getElementById('overviewPlanStatusCount');
  if(!host)return;
  var rows=getOverviewStatusPlans();
  if(count)count.textContent=rows.length+' plan'+(rows.length===1?'':'s')+' matching filters';
  if(!rows.length){host.innerHTML='<div class="sub plan-status-empty">No production plans match the selected date and filters.</div>';return;}
  host.innerHTML=rows.map(function(p){
    var qty=Number(p.qty)||0,actual=Number(p.actual)||0,rejected=Number(p.rejection)||0;
    var pct=qty?Math.max(0,Math.min(100,actual/qty*100)):0,status=getPlanStatusLabel(p);
    var statusClass=status==='In Progress'?'in-progress':status.toLowerCase();
    return '<article class="plan-status-card"><div class="plan-status-heading"><strong>'+escapeHtml(p.line)+' · '+escapeHtml(p.brand||'Unbranded')+'</strong><span class="plan-status-pill '+statusClass+'">'+status+'</span></div>'+
      '<div class="plan-status-product">'+escapeHtml(p.product||'—')+' <span>· Model '+escapeHtml(p.model||'—')+'</span></div>'+
      '<div class="plan-status-meta"><span>'+escapeHtml(p.date||'—')+'</span><span>'+escapeHtml(p.shift||'—')+'</span></div>'+
      '<div class="plan-status-numbers"><span><small>Planned</small><b>'+qty+'</b></span><span><small>Produced</small><b>'+actual+'</b></span><span><small>Accepted</small><b>'+Math.max(0,actual-rejected)+'</b></span><span><small>Rejected</small><b>'+rejected+'</b></span></div>'+
      '<div class="plan-status-track"><i style="width:'+pct.toFixed(1)+'%"></i></div><div class="plan-status-foot"><span>'+Math.round(pct)+'% complete</span><span>'+Math.max(0,qty-actual)+' remaining</span></div></article>';
  }).join('');
}
function renderOverviewSummary(f){
  var summary=document.getElementById('lineSummaryBody'),cards=document.getElementById('overviewLineCards');
  if(summary)summary.innerHTML=f.map(function(p){
    var pct=p.qty?Math.round(p.actual/p.qty*100):0;
    return '<tr><td>'+escapeHtml(p.line)+'</td><td>'+escapeHtml(p.brand||'—')+' · '+escapeHtml(p.product)+' <small>'+escapeHtml(p.model||'')+'</small></td><td>'+p.qty+'</td><td>'+p.actual+'</td><td>'+pct+'%</td><td><span class="pill '+(pct<80?'warn':'')+'">'+(pct<80?'Behind plan':'On track')+'</span></td></tr>';
  }).join('')||'<tr><td colspan="6">No active published plans match the selected filters.</td></tr>';
  if(cards)cards.innerHTML=f.map(function(p){
    var pct=p.qty?Math.min(100,p.actual/p.qty*100):0,remaining=Math.max(0,p.qty-p.actual);
    return '<div class="linecard"><div class="linehead">'+escapeHtml(p.line)+' <span class="pill '+(pct<80?'warn':'')+'">'+(pct<80?'Behind plan':'On track')+'</span></div>'+
      '<div class="sub" style="margin-top:7px">'+escapeHtml(p.brand||'—')+' · '+escapeHtml(p.product)+' · '+escapeHtml(p.model||'—')+' · '+p.actual+' / '+p.qty+' units</div>'+
      '<div class="progress"><i style="width:'+pct+'%"></i></div><div class="linemeta"><span>'+(p.qty?Math.round(p.actual/p.qty*100):0)+'% complete</span><span>'+remaining+' remaining</span></div></div>';
  }).join('')||'<div class="sub">No active plans for the selected filters.</div>';
}
function renderOverviewChart(){
  var host=document.getElementById('overviewBarChart');if(!host)return;
  var filtered=getOverviewPlans();
  renderOverviewChartPlanDetails([]);
  if(!filtered.length){
    host.innerHTML='<div class="chart-empty">No active published plans for the selected date and filters.</div>';
    updateOverviewKpis();return;
  }
  function renderPlanGraph(p){
    var labels=p.hourLabels||timeSlots(p.start,p.end,p.breakTimes||[]);
    var targets=planHourTargets(p);
    var actual=labels.map(function(_,i){return getHourlyActual(p,i);});
    var planned=labels.map(function(_,i){return Number(targets[i])||0;});
    var W=900,H=280,L=48,R=18,T=25,B=42,plotW=W-L-R,plotH=H-T-B;
    var max=Math.max(1,...planned,...actual),ceil=Math.max(1,Math.ceil(max/5)*5);
    var slot=plotW/Math.max(1,labels.length),barW=Math.min(22,slot*.28),svg=[];
    svg.push('<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="280" role="img" aria-label="Hourly plan versus actual for '+escapeHtml(p.line)+'">');
    for(var t=0;t<=4;t++){
      var val=ceil*t/4,y=T+plotH-(plotH*t/4);
      svg.push('<line x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'" stroke="#e8edf4"/><text x="'+(L-10)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="#8491a3">'+Math.round(val)+'</text>');
    }
    labels.forEach(function(label,i){
      var cx=L+slot*i+slot/2,ph=plotH*planned[i]/ceil,ah=plotH*actual[i]/ceil;
      var px=cx-barW-2,ax=cx+2,py=T+plotH-ph,ay=T+plotH-ah;
      svg.push('<rect x="'+px+'" y="'+py+'" width="'+barW+'" height="'+ph+'" rx="4" fill="#3978f6"/><rect x="'+ax+'" y="'+ay+'" width="'+barW+'" height="'+ah+'" rx="4" fill="#18a66b"/>');
      if(planned[i]>0)svg.push('<text x="'+(px+barW/2)+'" y="'+Math.max(14,py-6)+'" text-anchor="middle" font-size="11" font-weight="600" fill="#2459b8">'+planned[i]+'</text>');
      if(actual[i]>0)svg.push('<text x="'+(ax+barW/2)+'" y="'+Math.max(14,ay-6)+'" text-anchor="middle" font-size="11" font-weight="600" fill="#118456">'+actual[i]+'</text>');
      var shortLabel=label.split('–')[0];
      svg.push('<text x="'+cx+'" y="'+(H-13)+'" text-anchor="middle" font-size="10" fill="#7b8798">'+escapeHtml(shortLabel)+'</text>');
    });
    svg.push('</svg>');
    var pct=p.qty?Math.round(p.actual/p.qty*100):0;
    var breakText=(p.breakTimes||[]).map(function(x){
      return formatTime12(x.start_time||x.start)+'–'+formatTime12(x.end_time||x.end);
    }).join(', ');
    return '<article class="plan-hour-chart-card"><div class="plan-hour-chart-heading"><div><strong>'+escapeHtml(p.line)+' · '+escapeHtml(p.shift)+'</strong><small>'+escapeHtml(p.brand)+' · '+escapeHtml(p.product)+' · '+escapeHtml(p.model)+'</small></div><span>'+escapeHtml(getPlanStatusLabel(p))+'</span></div>'+
      '<div class="plan-hour-chart-meta"><span>Planned <b>'+p.qty+'</b></span><span>Actual <b>'+p.actual+'</b></span><span>'+pct+'% complete</span></div>'+
      (breakText?'<div class="plan-break-visible plan-chart-breaks">Breaks: '+escapeHtml(breakText)+'</div>':'')+
      '<div class="plan-hour-chart-svg">'+svg.join('')+'</div></article>';
  }
  host.innerHTML='<div class="plan-hour-chart-list">'+filtered.map(renderPlanGraph).join('')+'</div>';
  updateOverviewKpis();
}
function renderOverviewChartPlanDetails(){
  var host=document.getElementById('overviewChartPlanDetails');
  if(host)host.innerHTML='';
}
function makeOverviewReportCanvas(){
  var graphPlans=getOverviewPlans(),W=1200,header=230,chartCard=350,gap=18;
  var H=header+Math.max(1,graphPlans.length)*(chartCard+gap)+70;
  var canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  var ctx=canvas.getContext('2d');
  ctx.fillStyle='#f4f7fb';ctx.fillRect(0,0,W,H);
  function rr(x,y,w,h,r,fill,stroke){
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
    ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
  }
  function txt(value,x,y,size,color,weight){ctx.fillStyle=color;ctx.font=(weight||'400')+' '+size+'px Arial,sans-serif';ctx.fillText(String(value),x,y);}
  rr(24,20,W-48,H-40,20,'#fff','#dfe7f1');
  txt('PRODUCTION MANAGEMENT',58,72,25,'#172438','700');
  txt('HOURLY PLAN VS ACTUAL · SEPARATE PLAN REPORT',58,108,18,'#3978f6','700');
  var f=getOverviewPlanFilters();
  txt('Date: '+(f.date||'All dates')+'   Shift: '+f.shift+'   Line: '+f.line,58,146,15,'#526277');
  txt('Generated: '+new Date().toLocaleString(),58,178,13,'#8793a4');
  var y=header;
  graphPlans.forEach(function(p){
    rr(48,y,W-96,chartCard,14,'#fff','#e4eaf2');
    txt(p.line+' · '+p.shift+' · '+p.date,74,y+32,18,'#172438','700');
    txt((p.brand||'—')+' · '+(p.product||'—')+' · Model '+(p.model||'—'),74,y+58,14,'#526277');
    txt('Planned '+p.qty+'   Actual '+p.actual+'   Accepted '+(p.actual-p.rejection)+'   Rejected '+p.rejection+'   Status '+getPlanStatusLabel(p),74,y+86,14,'#334155','600');
    var labels=p.hourLabels||timeSlots(p.start,p.end),targets=planHourTargets(p);
    var actual=labels.map(function(_,i){return getHourlyActual(p,i);});
    var planned=labels.map(function(_,i){return Number(targets[i])||0;});
    var chartX=95,chartY=y+122,chartW=W-170,chartH=170,max=Math.max(1,...planned,...actual),ceil=Math.max(1,Math.ceil(max/5)*5);
    ctx.strokeStyle='#e8edf4';ctx.lineWidth=1;
    for(var j=0;j<=4;j++){
      var gy=chartY+chartH-(chartH*j/4);ctx.beginPath();ctx.moveTo(chartX,gy);ctx.lineTo(chartX+chartW,gy);ctx.stroke();
      txt(Math.round(ceil*j/4),chartX-38,gy+4,10,'#8793a4');
    }
    var slot=chartW/Math.max(1,labels.length),barW=Math.min(22,slot*.28);
    labels.forEach(function(label,i){
      var cx=chartX+slot*i+slot/2,ph=chartH*planned[i]/ceil,ah=chartH*actual[i]/ceil;
      rr(cx-barW-2,chartY+chartH-ph,barW,ph,4,'#3978f6');
      rr(cx+2,chartY+chartH-ah,barW,ah,4,'#18a66b');
      txt(planned[i],cx-barW-4,chartY+chartH-ph-5,10,'#2459b8','700');
      if(actual[i])txt(actual[i],cx+1,chartY+chartH-ah-5,10,'#118456','700');
      txt(label.split('–')[0],cx-21,chartY+chartH+18,9,'#64748b');
    });
    y+=chartCard+gap;
  });
  txt('Blue: Planned · Green: Actual',58,H-48,13,'#526277');
  return canvas;
}
function downloadOverviewReport(){
  var canvas=makeOverviewReportCanvas();
  canvas.toBlob(function(blob){
    if(!blob){toast('Could not create the production report image');return;}
    var url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
    a.download='production-status-'+(document.getElementById('overviewDateFilter')?.value||'report')+'.png';
    document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1500);
    closeChartExportMenu();toast('Production report PNG downloaded');
  },'image/png');
}
async function shareOverviewReport(){
  var canvas=makeOverviewReportCanvas();
  canvas.toBlob(async function(blob){
    if(!blob){toast('Could not create the production report image');return;}
    var name='production-status-'+(document.getElementById('overviewDateFilter')?.value||'report')+'.png';
    try{var file=new File([blob],name,{type:'image/png'});if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:'Production status report',text:'Production status report'});closeChartExportMenu();return;}}
    catch(error){if(error&&error.name==='AbortError')return;}
    downloadOverviewReport();
  },'image/png');
}
function openChartExportMenu(x,y){
  var menu=document.getElementById('chartExportMenu');if(!menu)return;
  menu.classList.remove('hidden');
  menu.style.left=Math.max(10,Math.min((x||20),window.innerWidth-220))+'px';
  menu.style.top=Math.max(10,Math.min((y||20),window.innerHeight-110))+'px';
}
function closeChartExportMenu(){var menu=document.getElementById('chartExportMenu');if(menu)menu.classList.add('hidden');}
function setupChartExportGestures(){
  var host=document.getElementById('overviewBarChart');if(!host||host.dataset.exportBound)return;
  host.dataset.exportBound='1';
  host.addEventListener('contextmenu',function(event){event.preventDefault();openChartExportMenu(event.clientX,event.clientY);});
  var timer=null,startX=0,startY=0;
  host.addEventListener('pointerdown',function(event){if(event.pointerType!=='touch')return;startX=event.clientX;startY=event.clientY;timer=setTimeout(function(){openChartExportMenu(startX,startY);},650);});
  ['pointerup','pointercancel','pointerleave'].forEach(function(name){host.addEventListener(name,function(){if(timer){clearTimeout(timer);timer=null;}});});
  host.addEventListener('pointermove',function(event){if(timer&&Math.abs(event.clientX-startX)+Math.abs(event.clientY-startY)>14){clearTimeout(timer);timer=null;}});
  document.addEventListener('click',function(event){if(!event.target.closest('#chartExportMenu')&&!event.target.closest('#overviewBarChart'))closeChartExportMenu();});
}
function refreshOverview(){refreshProductOptions();renderOverviewChart();updateOverviewKpis();}
function clearReportFilters(){
  ['reportFrom','reportTo'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  ['reportShift','reportLine','reportBrand','reportProduct','reportModel'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='all';});
  renderReports();
}
function filteredReportPlans(){
  var from=document.getElementById('reportFrom')?.value||'',to=document.getElementById('reportTo')?.value||'';
  var brand=document.getElementById('reportBrand')?.value||'all',product=document.getElementById('reportProduct')?.value||'all',model=document.getElementById('reportModel')?.value||'all',line=document.getElementById('reportLine')?.value||'all',shift=document.getElementById('reportShift')?.value||'all';
  return plans.filter(function(p){return (!from||p.date>=from)&&(!to||p.date<=to)&&(brand==='all'||p.brand===brand)&&(product==='all'||p.product===product)&&(model==='all'||p.model===model)&&(line==='all'||p.line===line)&&(shift==='all'||p.shift===shift);});
}
function renderReports(){
 var filtered=filteredReportPlans(),type=document.getElementById('reportType')?.value||'hourly',groups=new Map();
 function reasonQty(plan,reason){return Object.values(plan.entries||{}).reduce(function(n,e){return n+(e.reason===reason?(Number(e.rejected)||0):0);},0);}
 function makeKey(p,h){if(type==='hourly')return [p.date,p.shift,p.line,h].join(' · ');if(type==='day')return p.date;if(type==='month')return String(p.date||'').slice(0,7);if(type==='shift')return [p.date,p.shift,p.line].join(' · ');if(type==='model')return [p.brand,p.product,p.model].filter(Boolean).join(' · ');if(type==='product')return [p.brand,p.product].filter(Boolean).join(' · ');if(type==='brand')return p.brand||'—';if(type==='rejection')return [p.date,p.line,p.shift].join(' · ');if(type==='rework')return [p.date,p.line,p.shift,p.product,p.model].join(' · ');if(type==='sticker')return [p.date,p.line,p.shift,p.product,p.model].join(' · ');return p.id;}
 filtered.forEach(function(p){var hoursToUse=(type==='hourly'?Object.keys(p.entries||{}):['summary']);if(type==='rework'&&!sumRework(p,'Completed')&&!sumRework(p,'Pending')&&!sumRework(p,'Finally Rejected'))return;if(type==='sticker'&&!sumMissingSticker(p))return;hoursToUse.forEach(function(h){var key=makeKey(p,h),r=groups.get(key);if(!r){r={key:key,date:p.date,shift:p.shift,line:p.line,brand:p.brand,product:p.product,model:p.model,hour:type==='hourly'?(p.hourLabels?.[Number(h)]||hours[Number(h)]||('Hour '+(Number(h)+1))):'—',plan:0,actual:0,rejection:0,accepted:0,iqc:0,lqc:0,other:0,rework:0,pending:0,finalRejected:0,missing:0,achievement:0,status:getPlanStatusLabel(p),plans:[]};groups.set(key,r);}var entry=type==='hourly'?p.entries?.[h]:null; r.plan+=type==='hourly'?(Number(p.hourTargets?.[Number(h)])||0):Number(p.qty)||0;r.actual+=type==='hourly'?(Number(entry?.actual)||0):Number(p.actual)||0;r.rejection+=type==='hourly'?(Number(entry?.rejected)||0):Number(p.rejection)||0;r.accepted+=type==='hourly'?Math.max(0,(Number(entry?.actual)||0)-(Number(entry?.rejected)||0)):Math.max(0,(Number(p.actual)||0)-(Number(p.rejection)||0));r.iqc+=type==='hourly'?(entry?.reason==='IQC Rejection'?(Number(entry.rejected)||0):0):reasonQty(p,'IQC Rejection');r.lqc+=type==='hourly'?(entry?.reason==='LQC Rejection'?(Number(entry.rejected)||0):0):reasonQty(p,'LQC Rejection');r.other+=type==='hourly'?(entry?.rejected&&entry.reason!=='IQC Rejection'&&entry.reason!=='LQC Rejection'?(Number(entry.rejected)||0):0):Math.max(0,(Number(p.rejection)||0)-reasonQty(p,'IQC Rejection')-reasonQty(p,'LQC Rejection'));r.rework+=type==='hourly'?planReworkUnits(p).filter(x=>String(x.hour)===String(p.hourLabels?.[Number(h)])&&(x.unit.status||'Pending')==='Completed').length:sumRework(p,'Completed');r.pending+=type==='hourly'?planReworkUnits(p).filter(x=>String(x.hour)===String(p.hourLabels?.[Number(h)])&&(x.unit.status||'Pending')==='Pending').length:sumRework(p,'Pending');r.finalRejected+=type==='hourly'?planReworkUnits(p).filter(x=>String(x.hour)===String(p.hourLabels?.[Number(h)])&&(x.unit.status||'Pending')==='Finally Rejected').length:sumRework(p,'Finally Rejected');r.missing+=type==='hourly'?(Number(entry?.missingSerialQty)||0):sumMissingSticker(p);if(r.status!==getPlanStatusLabel(p))r.status='Mixed';r.plans.push(p);});});
 var rows=Array.from(groups.values()).map(function(r){r.achievement=r.plan?Math.round(r.actual/r.plan*100):0;return r;}).sort(function(a,b){return String(b.date).localeCompare(String(a.date))||String(a.key).localeCompare(String(b.key));});
 var titles={hourly:'Hourly production detail',day:'Daily production summary',month:'Monthly production summary',shift:'Shift production summary',model:'Model-wise production',product:'Product-wise production',brand:'Brand-wise production',rejection:'Rejection analysis',rework:'Rework disposition',sticker:'Missing / damaged sticker report'},subtitles={hourly:'Actual output for each production hour and shift',day:'Totals by production date',month:'Totals grouped by calendar month',shift:'Totals for each date, shift and line',model:'Compare production by model number',product:'Compare production by product',brand:'Compare production by brand',rejection:'Rejected quantity by recorded category',rework:'Rework pending, completed and finally rejected',sticker:'Missing sticker quantities by production entry'};
 document.getElementById('reportTableTitle').textContent=titles[type]||titles.hourly;document.getElementById('reportTableSubtitle').textContent=subtitles[type]||'';document.getElementById('reportTableCount').textContent=rows.length+' rows';document.getElementById('reportFilterSummary').textContent=filtered.length+' plans matched';renderReportRows(rows,type);
}
function sumMissingSticker(p){return Object.values(p.entries||{}).reduce(function(n,e){return n+(Number(e.missingSerialQty)||0);},0);}
function renderReportRows(rows,type){var totals=rows.reduce(function(a,r){a.plan+=r.plan;a.actual+=r.actual;a.rejected+=r.rejection;a.accepted+=r.accepted;a.rework+=r.rework;a.pending+=r.pending;a.finalRejected+=r.finalRejected;a.missing+=r.missing;return a;},{plan:0,actual:0,rejected:0,accepted:0,rework:0,pending:0,finalRejected:0,missing:0});var kpis=document.getElementById('reportKpis');kpis.innerHTML=[['Actual output',totals.actual],['Accepted',totals.accepted],['Rejected',totals.rejected],['Rework / pending',totals.rework+' / '+totals.pending],['Missing stickers',totals.missing]].map(function(x){return '<article class="report-kpi"><div class="klabel">'+x[0]+'</div><div class="kvalue">'+x[1]+'</div></article>';}).join('');
 var hourly=type==='hourly',headers=hourly?['Date','Shift','Line','Brand','Product / Model','Hour','Target','Actual','Rejected','Accepted','Achievement']:type==='rejection'?['Date','Shift','Line','Product / Model','Rejected','IQC','LQC','Other']:type==='rework'?['Date','Shift','Line','Product / Model','Reworked','Pending','Finally rejected']:type==='sticker'?['Date','Shift','Line','Product / Model','Missing sticker units']:['Period','Brand','Product','Model','Shift','Line','Planned','Actual','Rejected','Accepted','Reworked','Pending','Final rejected','Missing stickers','Achievement'];
 var tbody=rows.map(function(r){var productModel=(r.product||'—')+' / '+(r.model||'—'),base='<td>'+escapeHtml(r.date)+'</td><td>'+escapeHtml(r.shift)+'</td><td>'+escapeHtml(r.line)+'</td><td>'+escapeHtml(productModel)+'</td>';if(hourly)return '<tr>'+base.replace('</td><td>'+escapeHtml(productModel)+'</td>','</td><td>'+escapeHtml(r.brand)+'</td><td>'+escapeHtml(productModel)+'</td>')+'<td>'+escapeHtml(r.hour)+'</td><td>'+r.plan+'</td><td>'+r.actual+'</td><td>'+r.rejection+'</td><td>'+r.accepted+'</td><td>'+r.achievement+'%</td></tr>';if(type==='rejection')return '<tr>'+base+'<td>'+r.rejection+'</td><td>'+r.iqc+'</td><td>'+r.lqc+'</td><td>'+r.other+'</td></tr>';if(type==='rework')return '<tr>'+base+'<td>'+r.rework+'</td><td>'+r.pending+'</td><td>'+r.finalRejected+'</td></tr>';if(type==='sticker')return '<tr>'+base+'<td>'+r.missing+'</td></tr>';return '<tr><td>'+escapeHtml(r.key)+'</td><td>'+escapeHtml(r.brand)+'</td><td>'+escapeHtml(r.product)+'</td><td>'+escapeHtml(r.model)+'</td><td>'+escapeHtml(r.shift)+'</td><td>'+escapeHtml(r.line)+'</td><td>'+r.plan+'</td><td>'+r.actual+'</td><td>'+r.rejection+'</td><td>'+r.accepted+'</td><td>'+r.rework+'</td><td>'+r.pending+'</td><td>'+r.finalRejected+'</td><td>'+r.missing+'</td><td>'+r.achievement+'%</td></tr>';});var table=document.getElementById('reportTable');table.querySelector('thead').innerHTML='<tr>'+headers.map(x=>'<th>'+x.toUpperCase()+'</th>').join('')+'</tr>';table.querySelector('tbody').innerHTML=tbody.join('')||'<tr><td colspan="'+headers.length+'" class="report-empty">No records found for these filters.</td></tr>';document.getElementById('reportCards').innerHTML='';window.currentReportRows=rows;
}
function showReportHistory(i){
  const row=window.currentReportRows?.[i];if(!row)return;
  const detailRows=(row.plans||[]).flatMap(p=>planReworkUnits(p).map(item=>`<tr><td>${escapeHtml(p.date)}</td><td>${escapeHtml(p.line)}</td><td>${escapeHtml(p.product)} / ${escapeHtml(p.model||'—')}</td><td>${escapeHtml(item.hour)}</td><td>${escapeHtml(item.unit.serial||('Unit #'+(item.unit.unitNumber||item.unitIndex+1)))}</td><td>1</td><td>${escapeHtml(item.unit.reason||item.entry.reason||'—')}</td><td>${escapeHtml(reworkStatusLabel(item.unit.status||'Pending'))}</td><td>${escapeHtml(item.unit.remark||'—')}</td></tr>`)).join('');
  const modal=window.document.querySelector('#modal');
  modal.innerHTML=`<div class="modal rework-modal"><h2>Rejection & Rework History</h2><div class="sub">${escapeHtml(row.key)} · ${Number(row.rejection)||0} rejected units</div><div class="report-table-scroll" style="margin-top:16px"><table><thead><tr><th>Date</th><th>Line</th><th>Product / Model</th><th>Hour</th><th>Rejected unit</th><th>Qty</th><th>Original reason</th><th>Final status</th><th>Resolution remark</th></tr></thead><tbody>${detailRows||'<tr><td colspan="9" class="rework-empty">No rejection history.</td></tr>'}</tbody></table></div><div class="modalactions"><button class="btn" onclick="closePlanModal()">Close</button></div></div>`;
  modal.classList.remove('hidden');
}
function printReportPDF(){window.print();}
function exportReportCSV(){
  var table=document.getElementById('reportTable');if(!table)return;
  var rows=Array.from(table.querySelectorAll('tr')).map(function(tr){
    return Array.from(tr.querySelectorAll('th,td')).map(function(cell){return '"'+String(cell.innerText||'').replace(/"/g,'""')+'"';}).join(',');
  });
  if(rows.length<2)return toast('There are no report rows to export.');
  var blob=new Blob(['\uFEFF'+rows.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  var url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='production-report-'+todayLocalDate()+'.csv';
  document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  toast('Filtered production report exported.');
}
function refreshProductOptions(){
  var brands=pmBrandNames.slice(),products=pmProductNames.slice(),models=pmModelNumbers.slice();
  function fillSelect(id,values,label,firstValue){
    var el=document.getElementById(id);if(!el)return;
    var keep=el.value;
    el.innerHTML='<option value="'+firstValue+'">'+label+'</option>'+
      values.map(function(x){return '<option value="'+escapeHtml(x)+'">'+escapeHtml(x)+'</option>';}).join('');
    el.value=values.includes(keep)?keep:firstValue;
  }
  fillSelect('overviewBrandFilter',brands,'All brands','');
  fillSelect('overviewProductFilter',products,'All products','');
  fillSelect('reportBrand',brands,'All brands','all');
  fillSelect('reportProduct',products,'All products','all');
  fillSelect('reportModel',models,'All models','all');
}
function persistAppData(){
  // Business data is written directly to Supabase by each save operation.
  // This function intentionally never stores production records in browser storage.
}
function syncAll(){
  refreshProductOptions();
  try{renderPlans();}catch(e){console.error('Plans render error',e);}
  try{renderOperator();}catch(e){console.error('Operator render error',e);}
  try{renderOverviewChart();}catch(e){console.error('Overview render error',e);}
  try{renderReports();}catch(e){console.error('Reports render error',e);}
  try{renderRework();}catch(e){console.error('Rework render error',e);}
}
window.addEventListener('resize',()=>requestAnimationFrame(renderOverviewChart));window.addEventListener('pageshow',()=>requestAnimationFrame(renderOverviewChart));document.getElementById('reportType')?.addEventListener('change',renderReports);
initializeTodayDateFilters();syncAll();requestAnimationFrame(()=>{renderOverviewChart();setTimeout(renderOverviewChart,100);});
