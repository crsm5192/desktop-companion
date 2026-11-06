const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

module.exports = async function diagnose({ pet, pages, cdp, request, snapshot, report, artifacts, pause, waitFor, modelPath }) {
  const model = await snapshot()
  report.capabilities = model
  report.core = await pet.evaluate(`(async () => {
    const url = ${JSON.stringify(modelPath)};
    const setting = await (await fetch(url)).json();
    const prefix = url.slice(0,url.lastIndexOf('/')+1);
    const moc = Live2DCubismCore.Moc.fromArrayBuffer(await (await fetch(prefix+setting.FileReferences.Moc)).arrayBuffer());
    if (!moc) throw Error('Cubism core rejected moc');
    const core = Live2DCubismCore.Model.fromMoc(moc);
    try {
      const p = core.parameters, d = core.drawables;
      const capture = () => ({ vertices:d.vertexPositions.map(v=>Array.from(v)), opacities:Array.from(d.opacities) });
      const reset = () => { p.values.set(p.defaultValues);core.update(); };
      reset(); const neutral = capture();
      const compare = () => {
        const changed = []; let peak = 0, opacityPeak = 0;
        for(let i=0;i<d.count;i++) {
          let delta = 0;
          for(let j=0;j<d.vertexPositions[i].length;j++) delta=Math.max(delta,Math.abs(d.vertexPositions[i][j]-neutral.vertices[i][j]));
          const opacity=Math.abs(d.opacities[i]-neutral.opacities[i]);
          peak=Math.max(peak,delta);opacityPeak=Math.max(opacityPeak,opacity);
          if(delta>1e-6||opacity>1e-6) changed.push({id:d.ids[i],delta,opacity});
        }
        return {peak,opacityPeak,changed};
      };
      const parameters=[];
      for(let i=0;i<p.count;i++) {
        const samples=[];
        for(const value of [p.minimumValues[i],p.maximumValues[i]]) {
          reset();p.values[i]=value;core.update();samples.push({value,...compare()});
        }
        parameters.push({id:p.ids[i],default:p.defaultValues[i],samples});
      }
      const expressions=[];
      for(const exp of setting.FileReferences.Expressions||[]) {
        reset();const json=await(await fetch(prefix+exp.File)).json();
        for(const item of json.Parameters) {
          const i=p.ids.indexOf(item.Id);if(i<0)continue;
          if(item.Blend==='Overwrite') p.values[i]=item.Value;
          else if(item.Blend==='Multiply') p.values[i]*=item.Value;
          else p.values[i]+=item.Value;
        }
        core.update();expressions.push({name:exp.Name,parameters:Object.fromEntries(p.ids.map((id,i)=>[id,p.values[i]])),...compare()});
      }
      return {parameters,expressions,drawableCount:d.count,canvas:core.canvasinfo};
    } finally { core.release();moc._release(); }
  })()`)
  assert.ok(report.core.drawableCount > 0)
  console.log('CORE', JSON.stringify(report.core.parameters.map(p=>({id:p.id,range:p.samples.map(s=>s.value),meshDelta:Math.max(...p.samples.map(s=>s.peak)),changedDrawables:Math.max(...p.samples.map(s=>s.changed.length))}))))
  const capture = async name => {
    const image = await pet.send('Page.captureScreenshot', { format:'png' })
    const file = `model-${path.basename(modelPath,'.model3.json')}-${name}.png`
    fs.writeFileSync(path.join(artifacts,file),Buffer.from(image.data,'base64'));report.screenshots.push(file)
  }
  await capture('initial')
  await pet.evaluate(`window.api.panelWindow.setOpen('actions',true)`)
  const target = await waitFor(async()=> (await pages()).find(p=>p.url.endsWith('#panel=actions')))
  const actions = await cdp(target.webSocketDebuggerUrl)
  const click = name => actions.evaluate(`(() => {const button=[...document.querySelectorAll('.model-action-btn')].find(b=>b.title===${JSON.stringify(name)});if(!button)throw Error('Missing action');button.click();return true;})()`)
  const sampleRange = async (count=16,interval=65) => {
    const samples=[];
    for(let i=0;i<count;i++){samples.push(await snapshot());await pause(interval)}
    return Object.fromEntries(model.parameters.map(p=>{const values=samples.map(s=>s.parameters.find(v=>v.id===p.id).value);return [p.id,[Math.min(...values),Math.max(...values)]]}))
  }
  try {
    await waitFor(()=>actions.evaluate(`document.querySelectorAll('.model-action-btn').length>0`))
    report.manualExpressions=[]
    for(const exp of model.expressions) {
      await request('control.reset');await pause(400);await click(exp.name);await pause(850)
      const live = await snapshot();await capture(exp.name)
      report.manualExpressions.push({name:exp.name,selected:await pet.evaluate('window.__l2dDebug.rendering.expression'),parameters:Object.fromEntries(live.parameters.map(p=>[p.id,p.value]))})
    }
    // Use the smile expression, which does not overwrite head/gaze/mouth opening.
    await click(model.expressions.find(e=>e.name==='微笑')?.name ?? model.expressions[0].name)
    await actions.evaluate(`document.querySelectorAll('.model-actions-categories button')[1].click()`)
    await waitFor(()=>actions.evaluate(`document.querySelector('.model-action-btn[title="Nod"]')!==null`))
    report.manualMotions=[]
    for(const name of ['Nod','Shake','Blink','Wink','Bow','Talk','TalkHappy','LookAround']) {
      if(!model.motions.some(m=>m.name===name))continue
      await request('control.reset');await pause(400);await click(name)
      report.manualMotions.push({name,ranges:await sampleRange(24,65)});await capture(name)
    }
    report.apiMotions=[]
    for(const name of ['Nod','Talk']) {
      if(!model.motions.some(m=>m.name===name))continue
      await request('control.reset');await pause(400);await request('motion.play',{name,durationMs:2500})
      report.apiMotions.push({name,ranges:await sampleRange(24,65)})
    }
    console.log('EXPRESSIONS',JSON.stringify(report.manualExpressions))
    console.log('MOTIONS',JSON.stringify([...report.manualMotions,...report.apiMotions].map(m=>({name:m.name,ranges:Object.fromEntries(Object.entries(m.ranges).filter(([id])=>/Angle|Mouth|Eye|Brow/.test(id)))}))))
    if (process.argv.includes('--verify-model-fix')) {
      const surprise = report.manualExpressions.find(e=>e.name==='惊讶')
      const expectedMouth = report.core.expressions.find(e=>e.name==='惊讶').parameters.ParamMouthOpenY
      assert.ok(expectedMouth>0.1,'surprised expression has no authored mouth opening')
      assert.ok(Math.abs(surprise.parameters.ParamMouthOpenY-expectedMouth)<0.02,'surprised expression mouth opening was overridden')
      for(const motions of [report.manualMotions,report.apiMotions]) {
        assert.ok(motions.find(m=>m.name==='Nod').ranges.ParamAngleY[0]<-1,'authored nod head movement was overridden')
        assert.ok(motions.find(m=>m.name==='Talk').ranges.ParamMouthOpenY[1]>0.5,'authored talk mouth movement was overridden')
      }
      const blink = report.manualMotions.find(m=>m.name==='Blink')
      assert.ok(blink.ranges.ParamEyeLOpen[0]<0.2,'blink no longer closes the eye')
      await request('control.reset');await pet.evaluate('window.api.setConfig({pet:{eyeTracking:true}})');await pause(700)
      report.trackingIdle=await snapshot()
      await click('Nod');report.trackingNod=await sampleRange(32,65)
      assert.ok(report.trackingNod.ParamAngleY[0]<-1,'tracking overrides authored nod')
      await request('control.reset');await pause(700)
      report.trackingResumed=await snapshot()
      const expectedGaze=await pet.evaluate(`window.api.getCursor().then(c=>({x:Math.max(-1,Math.min(1,(c.cx-c.winX-c.winW/2)/(c.winW/2)))*1.5,y:-Math.max(-1,Math.min(1,(c.cy-c.winY-c.winH/2)/(c.winH/2)))*1.5}))`)
      for(const [axis,id] of [['x','ParamEyeBallX'],['y','ParamEyeBallY']]) {
        const p=report.trackingResumed.parameters.find(p=>p.id===id)
        assert.ok(Math.abs(p.value-Math.max(p.minimum,Math.min(p.maximum,expectedGaze[axis])))<0.1,'tracking did not resume')
      }
      await pet.evaluate('window.api.setConfig({pet:{eyeTracking:false}})')
      const mouthLevels=[]
      await request('expression.set',{name:'惊讶',durationMs:12000})
      await request('speech.play',{text:'本地口型测试'})
      for(let i=0;i<54;i++){mouthLevels.push((await snapshot()).parameters.find(p=>p.id==='ParamMouthOpenY').value);await pause(100)}
      report.speechMouthRange=[Math.min(...mouthLevels),Math.max(...mouthLevels)]
      assert.ok(report.speechMouthRange[0]<0.05 && report.speechMouthRange[1]>0.4,'speech no longer owns mouth opening')
      assert.ok(Math.abs((await snapshot()).parameters.find(p=>p.id==='ParamMouthOpenY').value-expectedMouth)<0.03,'silent mouth did not return to expression')
      report.checks.push('Surprised mouth, manual/API nod and talk, blink, tracking suspension/resumption and speech ownership verified')
    }
    report.checks.push('Compiled model evaluated independently; actual action-panel and API parameters sampled')
    report.success=true
  } finally { actions.socket.terminate() }
}
