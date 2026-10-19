import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { C, hexNum } from '../lib/palette';

/**
 * The field of points behind the whole page: a sparse constellation in gold
 * and ivory, drifting with scroll and pointer. Kept faint on purpose; it is
 * texture, not a feature.
 */
const NeuralField: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        const renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
        });
        renderer.setPixelRatio(dpr);
        renderer.setClearColor(0x000000, 0);

        const scene = new THREE.Scene();
        // Exponential depth fog — distant nodes melt into the background so the
        // field reads as soft depth instead of a bright wall of dots.
        scene.fog = new THREE.FogExp2(hexNum(C.ink), 0.028);
        const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
        camera.position.set(0, 0, 32);

        // ── Build the node cloud ────────────────────────────────────────────
        const N = 120;
        const RX = 30, RY = 20, RZ = 30;
        const verts: THREE.Vector3[] = [];
        for (let i = 0; i < N; i++) {
            verts.push(
                new THREE.Vector3(
                    (Math.random() * 2 - 1) * RX,
                    (Math.random() * 2 - 1) * RY,
                    (Math.random() * 2 - 1) * RZ
                )
            );
        }

        const pointPositions = new Float32Array(N * 3);
        verts.forEach((v, i) => {
            pointPositions[i * 3] = v.x;
            pointPositions[i * 3 + 1] = v.y;
            pointPositions[i * 3 + 2] = v.z;
        });

        // Soft circular sprite so nodes read as glowing dots, not squares.
        const dotCanvas = document.createElement('canvas');
        dotCanvas.width = dotCanvas.height = 64;
        const dctx = dotCanvas.getContext('2d')!;
        const grd = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,248,232,0.95)');
        grd.addColorStop(0.3, 'rgba(227,203,152,0.6)');
        grd.addColorStop(1, 'rgba(200,169,107,0)');
        dctx.fillStyle = grd;
        dctx.fillRect(0, 0, 64, 64);
        const dotTex = new THREE.CanvasTexture(dotCanvas);

        const pointsGeo = new THREE.BufferGeometry();
        pointsGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
        const pointsMat = new THREE.PointsMaterial({
            size: 0.75,
            map: dotTex,
            color: hexNum(C.goldLight),
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
            fog: true,
        });
        const points = new THREE.Points(pointsGeo, pointsMat);

        // ── Connections (each node → a few nearest neighbours) ──────────────
        const segs: number[] = [];
        const LINK_DIST = 11;
        const MAX_LINKS = 2;
        for (let i = 0; i < N; i++) {
            const near: { j: number; d: number }[] = [];
            for (let j = 0; j < N; j++) {
                if (i === j) continue;
                const d = verts[i].distanceTo(verts[j]);
                if (d < LINK_DIST) near.push({ j, d });
            }
            near.sort((a, b) => a.d - b.d);
            near.slice(0, MAX_LINKS).forEach(({ j }) => {
                if (j > i) {
                    segs.push(verts[i].x, verts[i].y, verts[i].z, verts[j].x, verts[j].y, verts[j].z);
                }
            });
        }
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
        const lineMat = new THREE.LineBasicMaterial({
            color: hexNum(C.gold),
            transparent: true,
            opacity: 0.09,
            blending: THREE.NormalBlending,
            depthWrite: false,
            fog: true,
        });
        const lines = new THREE.LineSegments(lineGeo, lineMat);

        const group = new THREE.Group();
        group.add(points);
        group.add(lines);
        scene.add(group);

        // ── Cinematic dust field — a slow fluid particle simulation that fills
        //    the space well beyond the neural net, giving the scene real depth.
        const SN = 420;
        const DUST = { x: 55, y: 34, z: 55 };
        const dustPos = new Float32Array(SN * 3);
        const dustSeed = new Float32Array(SN);
        for (let i = 0; i < SN; i++) {
            dustPos[i * 3] = (Math.random() * 2 - 1) * DUST.x;
            dustPos[i * 3 + 1] = (Math.random() * 2 - 1) * DUST.y;
            dustPos[i * 3 + 2] = (Math.random() * 2 - 1) * DUST.z;
            dustSeed[i] = Math.random() * Math.PI * 2;
        }
        const dustGeo = new THREE.BufferGeometry();
        dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
        const dustMat = new THREE.PointsMaterial({
            size: 0.4,
            map: dotTex,
            color: hexNum(C.ivory),
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
            fog: true,
        });
        const dust = new THREE.Points(dustGeo, dustMat);
        scene.add(dust);

        // ── Abstract wireframe monoliths drifting deep in the scene — barely
        //    visible geometry that reads as "structure" behind the data field.
        const knotGeo = new THREE.TorusKnotGeometry(8, 2.2, 96, 12);
        const knotMat = new THREE.MeshBasicMaterial({
            color: hexNum(C.gold),
            wireframe: true,
            transparent: true,
            opacity: 0.03,
        });
        const knot = new THREE.Mesh(knotGeo, knotMat);
        knot.position.set(-16, 6, -34);
        scene.add(knot);

        const icoGeo = new THREE.IcosahedronGeometry(10, 1);
        const icoMat = new THREE.MeshBasicMaterial({
            color: hexNum(C.slate),
            wireframe: true,
            transparent: true,
            opacity: 0.035,
        });
        const ico = new THREE.Mesh(icoGeo, icoMat);
        ico.position.set(20, -8, -46);
        scene.add(ico);

        // ── Interaction state ───────────────────────────────────────────────
        const mouse = { x: 0, y: 0 };
        const scrollState = { progress: 0, vel: 0 };
        let lastScrollY = window.scrollY;

        const cur = { rx: 0, ry: 0, z: 32, px: 0, py: 0, roll: 0 };

        const onPointer = (e: PointerEvent) => {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
        };
        const onScroll = () => {
            const y = window.scrollY;
            const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
            scrollState.progress = Math.min(1, y / max);
            scrollState.vel = Math.min(1, Math.abs(y - lastScrollY) / 40);
            lastScrollY = y;
        };

        const resize = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        resize();
        onScroll();

        window.addEventListener('resize', resize);
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('pointermove', onPointer, { passive: true });

        let raf = 0;
        let auto = 0;
        const clock = new THREE.Clock();

        const render = () => {
            const dt = Math.min(clock.getDelta(), 0.05);
            auto += dt * 0.02; // gentle perpetual drift
            const t = clock.elapsedTime;

            // Fluid drift for the dust field — a slow curl-like flow, wrapped
            // at the bounds so particles recycle forever.
            const dp = dustGeo.getAttribute('position') as THREE.BufferAttribute;
            for (let i = 0; i < SN; i++) {
                let x = dp.getX(i);
                let y = dp.getY(i);
                let z = dp.getZ(i);
                const s = dustSeed[i];
                x += Math.sin(t * 0.11 + s + y * 0.06) * dt * 1.1;
                y += Math.cos(t * 0.09 + s + z * 0.05) * dt * 0.8;
                z += Math.sin(t * 0.07 + s + x * 0.04) * dt * 1.0;
                if (x > DUST.x) x = -DUST.x; else if (x < -DUST.x) x = DUST.x;
                if (y > DUST.y) y = -DUST.y; else if (y < -DUST.y) y = DUST.y;
                if (z > DUST.z) z = -DUST.z; else if (z < -DUST.z) z = DUST.z;
                dp.setXYZ(i, x, y, z);
            }
            dp.needsUpdate = true;

            // Slow tumble for the deep wireframe structures.
            knot.rotation.x += dt * 0.05;
            knot.rotation.y += dt * 0.07;
            ico.rotation.y -= dt * 0.04;
            ico.rotation.z += dt * 0.03;

            // Smoothly chase scroll + pointer driven targets. No brightness
            // pulsing — the slow motion alone carries it, so it stays easy on the eyes.
            const tRy = auto + scrollState.progress * Math.PI * 0.9 + mouse.x * 0.18;
            const tRx = mouse.y * 0.12 + scrollState.progress * 0.28;
            const tZ = 32 - scrollState.progress * 18; // gentle dolly through the net
            const tPx = mouse.x * 2.2; // camera parallax → layered depth
            const tPy = -mouse.y * 1.4;
            const tRoll = Math.sin(scrollState.progress * Math.PI) * 0.05 + mouse.x * 0.015;

            cur.ry += (tRy - cur.ry) * 0.035;
            cur.rx += (tRx - cur.rx) * 0.035;
            cur.z += (tZ - cur.z) * 0.035;
            cur.px += (tPx - cur.px) * 0.03;
            cur.py += (tPy - cur.py) * 0.03;
            cur.roll += (tRoll - cur.roll) * 0.03;

            group.rotation.y = cur.ry;
            group.rotation.x = cur.rx;
            camera.position.set(cur.px, cur.py, cur.z);
            camera.rotation.z = cur.roll; // subtle cinematic roll while dollying

            renderer.render(scene, camera);
            raf = requestAnimationFrame(render);
        };

        if (reduced) {
            renderer.render(scene, camera);
        } else {
            raf = requestAnimationFrame(render);
        }

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('pointermove', onPointer);
            pointsGeo.dispose();
            lineGeo.dispose();
            pointsMat.dispose();
            lineMat.dispose();
            dustGeo.dispose();
            dustMat.dispose();
            knotGeo.dispose();
            knotMat.dispose();
            icoGeo.dispose();
            icoMat.dispose();
            dotTex.dispose();
            renderer.dispose();
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{
                opacity: 0.55,
                maskImage:
                    'radial-gradient(ellipse 75% 75% at 50% 32%, black 50%, transparent 100%)',
                WebkitMaskImage:
                    'radial-gradient(ellipse 75% 75% at 50% 32%, black 50%, transparent 100%)',
            }}
            aria-hidden="true"
        />
    );
};

export default NeuralField;
