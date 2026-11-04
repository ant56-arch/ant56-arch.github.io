// Sports Edge lab: 3D players. A rigged mannequin (Quaternius, CC0) dressed in
// each player's kit and driven by real motion clips (idle, walk, jog, sprint,
// jump, defensive crouch), drawn through the same camera as the 2D field and
// composited into it, so the field, ball and rim stay as they are.
import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { clone as cloneSkinned } from "./vendor/SkeletonUtils.js";

// body regions, by the bone that moves each vertex most
const REGION = { skin: 0, jersey: 1, shorts: 2, shoe: 3, sock: 4 };
function regionOf(bone, kind) {
  if (/head|neck/.test(bone)) return REGION.skin;
  if (/hand|f_|thumb|forearm/.test(bone)) return REGION.skin;
  if (/upper_arm/.test(bone)) return kind === "court" ? REGION.skin : REGION.jersey;
  if (/spine|shoulder/.test(bone)) return REGION.jersey;
  if (/hips|thigh/.test(bone)) return REGION.shorts;
  if (/shin/.test(bone)) return kind === "pitch" || kind === "park" ? REGION.sock : REGION.skin;
  if (/foot|toe/.test(bone)) return REGION.shoe;
  return REGION.jersey;
}

export async function create(base) {
  const gltf = await new GLTFLoader().loadAsync(base + "models/player.glb");
  const src = gltf.scene, clips = {};
  gltf.animations.forEach(a => { clips[a.name] = a; });
  // stand him 1.9 m tall, feet on the floor
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src), tall = box.max.y - box.min.y || 1;
  const scale = 1.9 / tall, foot = box.min.y;

  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2a1c, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(-4, 12, 6); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  const pool = [], byKind = {};

  // tag each vertex with its body region (once per sport: arms are bare on a court, sleeved elsewhere)
  const geoCache = {};
  function regions(mesh, kind) {
    const key = kind + ":" + mesh.name;
    if (geoCache[key]) return geoCache[key];
    const g = mesh.geometry.clone(), si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = mesh.skeleton.bones;
    const reg = new Float32Array(si.count);
    for (let i = 0; i < si.count; i++) {
      let best = 0, w = -1;
      const ws = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)], js = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
      for (let k = 0; k < 4; k++) if (ws[k] > w) { w = ws[k]; best = js[k]; }
      reg[i] = regionOf(String((bones[best] || {}).name || ""), kind);
    }
    g.setAttribute("region", new THREE.BufferAttribute(reg, 1));
    return (geoCache[key] = g);
  }

  // one player: his own copy of the rig, his kit colors in the shader, his clips
  function makePlayer(kind) {
    const root = cloneSkinned(src), u = {
      cSkin: { value: new THREE.Color() }, cJersey: { value: new THREE.Color() }, cShorts: { value: new THREE.Color() },
      cShoe: { value: new THREE.Color(0x151515) }, cSock: { value: new THREE.Color() },
    };
    root.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.geometry = regions(o, kind);
      const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float region;\nvarying float vRegion;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRegion = region;");
        sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vRegion;\nuniform vec3 cSkin, cJersey, cShorts, cShoe, cSock;")
          .replace("vec4 diffuseColor = vec4( diffuse, opacity );", `vec3 kc = vRegion < 0.5 ? cSkin : vRegion < 1.5 ? cJersey : vRegion < 2.5 ? cShorts : vRegion < 3.5 ? cShoe : cSock;
            vec4 diffuseColor = vec4( kc, opacity );`);
      };
      o.material = m; o.frustumCulled = false;
    });
    const holder = new THREE.Group(); holder.add(root);
    root.scale.setScalar(scale); root.position.y = -foot * scale;
    const mixer = new THREE.AnimationMixer(root), act = {};
    Object.keys(clips).forEach(n => { act[n] = mixer.clipAction(clips[n]); act[n].play(); act[n].setEffectiveWeight(0); });
    return { holder, u, mixer, act, cur: null, yaw: 0, kind };
  }

  // which clip fits what the 2D engine says he's doing
  function clipFor(p, speed) {
    if ((p.Y || 0) > 0.05 || p.arms === "up" || p.arms === "shoot") return "Jump_Loop";
    if (p.arms === "guard") return speed > 0.6 ? "Crouch_Fwd_Loop" : "Crouch_Idle_Loop";
    if ((p.crouch || 1) < 0.9) return "Crouch_Idle_Loop";
    if (speed < 0.35) return "Idle_Loop";
    if (speed < 1.8) return "Walk_Loop";
    if (speed < 5) return "Jog_Fwd_Loop";
    return "Sprint_Loop";
  }

  return {
    // players: from the 2D engine ({X, Z, Y, kit, skin, speed, dirX, dirZ, arms, ...});
    // cam: {f, hz, cx, h}; draws into ctx at the camera's pan (ox)
    draw(ctx, players, view, dt) {
      const { W, H, f, hz, cx, h, ox, M, kind, dpr } = view;
      const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { renderer.setPixelRatio(dpr); renderer.setSize(W, H, false); }
      camera.fov = 2 * Math.atan(H / 2 / f) * 180 / Math.PI; camera.aspect = W / H;
      // principal point at (W/2 + M + ox, hz), as in the 2D camera
      camera.setViewOffset(W, H, -(M + ox), H / 2 - hz, W, H);
      camera.position.set(cx, h, 0); camera.lookAt(cx, h, -1); camera.updateProjectionMatrix();
      const list = byKind[kind] || (byKind[kind] = []);
      while (list.length < players.length) { const pl = makePlayer(kind); list.push(pl); scene.add(pl.holder); }
      list.forEach((pl, i) => { pl.holder.visible = i < players.length; });
      Object.keys(byKind).forEach(k => { if (k !== kind) byKind[k].forEach(pl => { pl.holder.visible = false; }); });
      players.forEach((p, i) => {
        const pl = list[i], k = p.kit || [];
        pl.u.cSkin.value.set(p.skin || "#B07A4E");
        pl.u.cJersey.value.set(k[2] || "#888888");
        const jc = pl.u.cJersey.value.clone();
        pl.u.cShorts.value.copy(kind === "park" || kind === "pitch" && (k[2] || "").toLowerCase() === "#f4f4f4" ? new THREE.Color(0xf2f2f2) : jc.multiplyScalar(0.85));
        pl.u.cSock.value.set(k[2] || "#888888");
        pl.holder.position.set(p.X, p.Y || 0, -p.Z);
        // face where he's going (or the way the play says), turning smoothly
        const want = p.moving ? Math.atan2(p.dirX, -p.dirZ) : Math.atan2(p.face || 1, 0);
        let d = want - pl.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); pl.yaw += d * Math.min(1, dt * 8);
        pl.holder.rotation.y = pl.yaw;
        const name = clipFor(p, p.speed);
        if (name !== pl.cur) { pl.cur = name; }
        Object.keys(pl.act).forEach(n => {
          const a = pl.act[n], w = a.getEffectiveWeight(), to = n === name ? 1 : 0;
          a.setEffectiveWeight(w + (to - w) * Math.min(1, dt * 7));
        });
        // feet keep pace with the ground: jog cycles ~1.6 m, sprint ~2.6 m
        const run = pl.act.Jog_Fwd_Loop, spr = pl.act.Sprint_Loop, wk = pl.act.Walk_Loop;
        if (run) run.timeScale = Math.max(0.6, p.speed / 3.2);
        if (spr) spr.timeScale = Math.max(0.7, p.speed / 6);
        if (wk) wk.timeScale = Math.max(0.6, p.speed / 1.3);
        pl.mixer.update(dt);
      });
      renderer.render(scene, camera);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(canvas, 0, 0, pw, ph); ctx.restore();
    },
  };
}
