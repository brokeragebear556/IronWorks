/* Automatic fit and legal checks, recomputed from the build as it's configured.
   Federal (NFA) rules only, as plain guidance; state law varies and changes. */
import type { Built } from './assemble'
import { defaultPos, riserUnder, suppMount } from './attachments'
import { AR_STOCK, CART, GASBAND, MOUNTSYS, effH, plOK, slotDef, type Cat, type EngAtt } from './data'
import { fmtLen, type Units } from './specs'

export type Level = 'ok' | 'check' | 'fail' | 'info'
export interface CheckItem { lvl: Level; text: string; why?: string }
export interface NfaRecord { item?: string; status?: string; form?: string; ctl?: string }
export interface CheckCtx {
  units: Units
  nfa?: NfaRecord | null
  /** NFA status per attachment id (suppressors) */
  attNfa: Record<string, string | undefined>
  sinceClean: number
  cleanEvery: number
  /** text to look for "optic ready" in */
  slideText: string
}
export interface NfaClass { cls: string; nfa: boolean; item: string; effBarrel: number; oal: number; pistol?: boolean }

const sn = (n: string | undefined) => String(n || '').split(' (')[0]
const TOPK = ['reddot', 'holo', 'prism', 'lpvo', 'scope', 'magn', 'riser', 'buis', 'offset']

/** Rifle, pistol, SBR or SBS, from barrel length (with a pinned & welded device), overall length and stock. */
export function nfaClass(b: Built): NfaClass {
  const { info: I, gun: g } = b, c = g.cfg
  const bl = c.barrel ?? 0, pw = !!c.pinned && I.md.prot > 0
  const effBarrel = pw ? bl + I.md.prot : bl
  const stocked = ['ar15', 'ar10', 'mp5', 'ak'].includes(g.platform) ? !['none', 'brace'].includes(c.stock ?? 'none') : g.platform === 'shotgun'
  const oal = I.devEnd - I.buttMin // ATF measures with an adjustable stock fully extended
  if (g.platform === 'pistol') return { cls: 'Handgun', nfa: false, item: 'none', effBarrel, oal }
  if (g.platform === 'shotgun') return effBarrel < 18 || oal < 26 ? { cls: 'Short-barreled shotgun (NFA)', nfa: true, item: 'sbs', effBarrel, oal } : { cls: 'Shotgun (Title I)', nfa: false, item: 'none', effBarrel, oal }
  if (stocked && (effBarrel < 16 || oal < 26)) return { cls: 'Short-barreled rifle (NFA)', nfa: true, item: 'sbr', effBarrel, oal }
  if (!stocked) return { cls: c.stock === 'brace' ? 'Pistol with a brace' : 'Pistol (no stock)', nfa: false, item: 'none', effBarrel, oal, pistol: true }
  return { cls: 'Rifle (Title I)', nfa: false, item: 'none', effBarrel, oal }
}

interface RailUse { a: EngAtt; x0: number; x1: number; onRiser: boolean; part?: string }
function railUse(b: Built): RailUse[] {
  const { info: I, gun: g } = b
  if (I.pistol || I.noRail) return []
  const out: RailUse[] = []
  for (const a of g.atts.filter((x) => TOPK.includes(x.k))) {
    const p = a.pos ?? defaultPos(a, I), L = a.len || 2, onRiser = riserUnder(g, a, I) > 0
    if (a.k === 'buis') { out.push({ a, x0: I.railStart + 0.2, x1: I.railStart + 1.5, onRiser, part: 'rear' }, { a, x0: I.railEnd - 1.4, x1: I.railEnd - 0.3, onRiser, part: 'front' }); continue }
    let x0 = p, x1 = p + L
    if (a.k === 'lpvo' || a.k === 'scope') { x0 = p + 3.3; x1 = p + 7.5 }
    else if (a.k === 'reddot' || a.k === 'magn') { const f = Math.min(L * 0.85, 2.2); x0 = p + (L - f) / 2; x1 = x0 + f }
    else if (a.k === 'prism') { const f = Math.min(L * 0.7, 2.4); x0 = p + (L - f) / 2; x1 = x0 + f }
    else if (a.k === 'offset') { x0 = p + 0.4; x1 = p + 1.5 }
    out.push({ a, x0, x1, onRiser })
  }
  return out
}

export function runChecks(b: Built, cat: Cat, ctx: CheckCtx): CheckItem[] {
  const { info: I, gun: g } = b, c = g.cfg, out: CheckItem[] = []
  const add = (lvl: Level, text: string, why?: string) => out.push({ lvl, text, why })
  const L = (v: number) => fmtLen(v, ctx.units)
  const md = I.md, cls = nfaClass(b), bul = CART[g.caliber ?? '']?.bd, ar = g.platform === 'ar15' || g.platform === 'ar10'
  const row = (slot: string) => g.build.find((r) => r.slot === slot)
  const suggestMz = (sys: string, th?: string) => cat.parts.filter((p) => p.s === 'muzzle' && p.mt === sys && (!th || p.th === th) && plOK(p, g, true)).sort((x, y) => (x.p || 0) - (y.p || 0)).slice(0, 3).map((p) => p.n).join(', ')
  const suggestAd = (fam: string, th?: string, sys?: string) => cat.acc.filter((x) => x.k === 'smount' && x.fam === fam && (!th || !x.th || x.th === th) && (!sys || x.gives === sys)).slice(0, 3).map((x) => x.n).join(', ')

  // ---- classification
  if (cls.nfa) {
    const st = ctx.nfa?.status
    if (st === 'approved') add('ok', `${cls.cls}: approved stamp on file${ctx.nfa?.ctl ? ` (${ctx.nfa.ctl})` : ''}.`, 'Keep the approved form with the gun. Form 1 builds must be engraved (27 CFR 479.102).')
    else add('fail', `${cls.cls}: this setup needs an approved ${ctx.nfa?.form || 'Form 1 or Form 4'} before it's assembled.`, `Barrel ${L(cls.effBarrel)}${c.pinned ? ' including the pinned device' : ''}, overall length ${L(cls.oal)} with the stock extended. Record the stamp in Records.`)
  } else if (ar && !cls.pistol) {
    if ((c.barrel ?? 0) < 16 && c.pinned) add('ok', `The pinned & welded ${sn(row('muzzle')?.name || md.n)} brings the barrel to ${L(cls.effBarrel)}, so it's a Title I rifle.`, 'The device must be permanently attached: pinned and welded, or high-temperature silver soldered.')
    else add('ok', `Rifle: barrel ${L(c.barrel ?? 0)} and overall length ${L(cls.oal)} clear the 16" and 26" federal minimums.`)
  }
  if (cls.pistol) {
    add('info', `${cls.cls}. Brace rules and state laws have changed several times. Check the current federal and state rules before changing the setup.`)
    if (g.atts.some((a) => a.k === 'vfg' && a.st !== 'angled')) add('fail', 'A vertical foregrip on a pistol can make it an AOW under the NFA.', 'Use a hand stop or an angled grip instead, or register it as an SBR first.')
    if (ar && (c.barrel ?? 16) < 16) add('check', `Adding a stock with this ${L(c.barrel ?? 0)} barrel would make an SBR. Get an approved Form 1 first.`)
  }
  if (c.pinned && md.prot <= 0) add('fail', "Pinned & welded is set, but there's no muzzle device to pin.")

  // ---- parts: platform and spec agreement
  for (const r of g.build) {
    const cp = r.pid ? cat.PB[r.pid] : undefined
    if (!cp) continue
    const lbl = slotDef(g.platform, r.slot)?.[1] ?? r.slot
    if (!plOK(cp, g, false)) {
      if (plOK(cp, g, true)) add('check', `${lbl}: ${cp.n} is an AR-15 part on an AR-10. Most large-frame lowers take it, but confirm.`, 'Triggers, grips, selectors and stocks usually cross over. Pins (.154" vs .170") and buffer parts may not.')
      else add('fail', `${lbl}: ${cp.n} doesn't fit this platform.`, 'Pick a part listed for this platform.')
    }
    const pc = (cp.c ?? {}) as Record<string, unknown>
    if (r.slot === 'barrel' && typeof pc.barrel === 'number' && Math.abs(pc.barrel - (c.barrel ?? 0)) > 0.05) add('check', `The barrel part is ${L(pc.barrel)}, but the model settings say ${L(c.barrel ?? 0)}.`, 'Pick the barrel again, or fix the length in Build → Model settings.')
    if (r.slot === 'barrel' && pc.caliber && pc.caliber !== g.caliber) add('fail', `The barrel is ${pc.caliber}, but the build is set to ${g.caliber}.`)
    if (r.slot === 'gastube' && pc.gas && c.gas && pc.gas !== c.gas && c.gas !== 'none') add('fail', `${String(pc.gas)}-length gas tube on a ${c.gas}-length system.`, `Use a ${c.gas}-length tube.`)
    if (r.slot === 'hg' && typeof pc.hg === 'number' && Math.abs(pc.hg - (c.hg ?? 0)) > 0.05) add('check', `The handguard part is ${L(pc.hg)}, but the model settings say ${L(c.hg ?? 0)}.`)
    if (r.slot === 'stock' && pc.stock && pc.stock !== c.stock) add('check', `The stock part is ${AR_STOCK[String(pc.stock)]?.n ?? pc.stock}, but the model shows ${AR_STOCK[c.stock ?? '']?.n ?? c.stock}.`)
    if (r.slot === 'pbarrel' && cp.threaded && !c.threaded) add('check', "A threaded barrel is installed but the model isn't set to threaded.")
    if (r.slot === 'mag' && typeof cp.cap === 'number' && c.magCap && cp.cap !== c.magCap) add('info', `The magazine is listed as ${cp.cap} rounds; Operate uses ${c.magCap}.`)
  }
  if (ar) {
    const tube = c.tube || 'carbine', st = AR_STOCK[c.stock ?? '']
    if (tube === 'rifle' && st?.adj && c.stock !== 'brace') add('fail', `A ${st.n} stock needs a carbine buffer tube; the build has a rifle tube.`)
    if (tube === 'carbine' && c.stock === 'a2') add('fail', 'A fixed rifle-length stock needs a rifle buffer tube.')
    const buf = row('buffer')?.pid ? cat.PB[row('buffer')!.pid!] : undefined
    if (buf && /rifle/i.test(buf.n) && tube === 'carbine') add('fail', `${buf.n} is a rifle buffer; it won't fit a carbine tube.`)
    if (buf && !/rifle/i.test(buf.n) && tube === 'rifle' && !/a5/i.test(buf.n)) add('check', `${buf.n} in a rifle tube. Use a rifle buffer and spring.`)
    const ch = row('ch')?.pid ? cat.PB[row('ch')!.pid!] : undefined
    if (ch && g.platform === 'ar10' && ch.pl === 'a15') add('fail', `${ch.n} is an AR-15 charging handle; AR-10 uppers need the large-frame length.`)
  }
  // ---- gas
  if (ar && c.gas && c.gas !== 'none') {
    const [lo, hi] = GASBAND[c.gas] ?? [0, 99], bl = c.barrel ?? 0, G = c.gas[0].toUpperCase() + c.gas.slice(1)
    if (bl < lo - 0.75) add('fail', `${G} gas on a ${L(bl)} barrel puts the port too close to the muzzle.`, `The usual ${c.gas} range is about ${lo}–${hi}".`)
    else if (bl < lo - 0.01) add('check', `${G} gas on a ${L(bl)} barrel leaves little barrel past the gas port (short dwell). It usually runs but can be picky about ammo.`, `The usual ${c.gas} range is about ${lo}–${hi}".`)
    else if (bl > hi + 0.01) add('check', `${G}-length gas is short for a ${L(bl)} barrel. Expect a harder recoil impulse.`, `The usual ${c.gas} range is about ${lo}–${hi}".`)
    else add('ok', `${G}-length gas suits a ${L(bl)} barrel.`)
  }
  if (ar && I.hgEnd > I.muzzleX - 0.25) add('check', `The handguard (${L(c.hg ?? 0)}) reaches the muzzle. The muzzle device and any suppressor must clear it.`)
  // ---- muzzle device
  if (c.muzzle) {
    if (md.th !== 'any' && c.thread && c.thread !== 'none' && md.th !== c.thread) add('fail', `${md.n} is ${md.th}, but the barrel is threaded ${c.thread}.`, `Pick a ${c.thread} device in Build.`)
    if (c.thread === 'none') add('fail', `${sn(md.n)} needs a threaded barrel; this barrel isn't threaded.`)
  }
  if (c.thread === '5/8x24' && ['5.56 NATO', '.223 Rem', '.22 LR'].includes(g.caliber ?? '')) add('check', '5/8x24 threads on a .22-caliber barrel are unusual. Confirm the thread pitch.')
  if (c.thread === '1/2x28' && ['.308 Win', '6.5 Creedmoor', '.300 BLK'].includes(g.caliber ?? '')) add('check', `1/2x28 threads on a ${g.caliber} barrel are unusual (5/8x24 is standard). Confirm the thread pitch.`)
  // ---- suppressors
  for (const a of g.atts.filter((x) => x.k === 'supp')) {
    const m = suppMount(cat, a, g), nm = sn(a.n), bore = parseFloat(a.bore ?? '') || 0, ad = a.ad ? cat.AB[a.ad] : undefined
    if (bul && bore && bul > bore - 0.015) add('fail', `${nm}'s bore (${a.bore}) is too tight for ${g.caliber} (${bul}").`, "The can's rated bore must clear the bullet with margin.")
    else if (bul && bore) add('ok', `${nm} (${a.bore} bore) is rated for ${g.caliber}.`)
    if (a.rear && a.rear !== 'fixed') {
      if (!ad) add('fail', `${nm} uses ${a.rear.toUpperCase()}-family rear threads and needs a mount.`, suggestAd(a.rear, c.thread) ? `For example: ${suggestAd(a.rear, c.thread)}. Choose one in Attachments.` : 'Choose one in Attachments.')
      else if (ad.fam !== a.rear) add('fail', `${ad.n} is a ${ad.fam} mount; ${nm} takes ${a.rear} mounts.`)
    }
    const qd = !['thread', 'piston', 'choke'].includes(m.sys)
    if (qd) {
      if (md.mount === m.sys) add('ok', `${nm} locks onto the ${sn(md.n)} (${MOUNTSYS[m.sys] ?? m.sys}).`)
      else {
        const s = suggestMz(m.sys, c.thread)
        add('fail', `${nm} is set up for ${MOUNTSYS[m.sys] ?? m.sys}, but ${c.muzzle ? `the ${sn(md.n)} isn't a ${MOUNTSYS[m.sys] ?? m.sys} device` : "the muzzle device isn't one from the catalog"}.`, s ? `Matching devices: ${s}.` : undefined)
      }
    } else {
      if (m.th && c.thread && m.th !== c.thread && c.thread !== 'none') add('fail', `${ad ? ad.n : nm} is ${m.th}; the barrel is ${c.thread}.`)
      if (c.thread === 'none' || (g.platform === 'pistol' && !c.threaded)) add('fail', `${nm} threads on, but the barrel isn't threaded.`)
      if ((c.muzzle || (c.muzzleStyle && c.muzzleStyle !== 'none' && c.muzzleStyle !== 'cap')) && m.sys !== 'choke') add('check', `Direct-thread can: take the muzzle device off before threading ${nm} on.`)
    }
    if (g.platform === 'pistol' && m.sys !== 'piston') add('fail', `${nm} needs a booster (piston) mount on a tilting-barrel pistol, or it won't cycle.`)
    if (g.platform !== 'pistol' && m.sys === 'piston') add('check', 'Booster mount on a long gun: use a fixed mount or lock it with the fixed-barrel spacer.')
    if (ar && !c.gasAdj && c.gas !== 'none') add('check', 'Suppressed gas gun without an adjustable gas block. Expect more gas to the face and faster fouling.')
    const st = ctx.attNfa[a.id]
    if (st !== 'approved') add('fail', `${nm}: the Form 4 status is "${st || 'not recorded'}". You need an approved stamp to possess it.`, 'Record it in Records → Suppressors.')
    else add('ok', `${nm}: approved Form 4 on file.`)
    if (g.rimfire && !/22|rim/i.test(a.n)) add('check', "Rimfire is dirty in centerfire cans. Check the maker's rimfire guidance and cleaning method.")
    if (a._x0 != null && I.hgEnd > a._x0 + 0.1 && (a.dia || 1.5) > 1.45) add('check', `${nm}'s rear sits ${L(I.hgEnd - a._x0)} inside the handguard. Confirm the ${L(a.dia || 1.5)} can clears the rail.`)
  }
  // ---- optics
  const ru = railUse(b)
  ru.forEach((s, i) => ru.forEach((t, j) => {
    if (j > i && s.a !== t.a && !(s.onRiser && t.a.k === 'riser') && !(t.onRiser && s.a.k === 'riser') && s.x0 < t.x1 - 0.05 && t.x0 < s.x1 - 0.05)
      add('fail', `${sn(s.a.n)}${s.part ? ` (${s.part})` : ''} and ${sn(t.a.n)}${t.part ? ` (${t.part})` : ''} overlap on the top rail.`, 'Slide one along the rail in Attachments.')
  }))
  ru.forEach((s) => { if (s.x0 < I.railStart - 0.05 || s.x1 > I.railEnd + 0.05) add('fail', `${sn(s.a.n)} hangs off the top rail.`) })
  const dot = g.atts.find((a) => ['reddot', 'holo', 'prism'].includes(a.k)), mag = g.atts.find((a) => a.k === 'magn'), lp = g.atts.find((a) => a.k === 'lpvo' || a.k === 'scope'), bu = g.atts.find((a) => a.k === 'buis')
  if (dot && mag) {
    const dh = effH(cat, dot) + riserUnder(g, dot, I), mh = effH(cat, mag) + riserUnder(g, mag, I)
    if (Math.abs(dh - mh) > 0.06) add('fail', `The magnifier's centreline (${L(mh)}) doesn't match the ${sn(dot.n)} (${L(dh)}).`, 'Match the mount heights so the dot sits in the middle of the magnifier.')
    else add('ok', `The magnifier and ${sn(dot.n)} share a ${L(dh)} centreline.`)
    if ((mag.pos ?? defaultPos(mag, I)) > (dot.pos ?? defaultPos(dot, I))) add('fail', 'The magnifier must sit behind the red dot.')
  }
  if (dot && bu && dot.k !== 'prism') {
    const h = effH(cat, dot) + riserUnder(g, dot, I)
    add(h <= 1.6 ? 'ok' : 'info', h <= 1.45 ? 'Absolute co-witness with the backup sights.' : h <= 1.6 ? 'Lower 1/3 co-witness with the backup sights.' : `The optic at ${L(h)} sits above co-witness, so the irons will be low in the window.`)
  }
  if (lp && bu && bu.st !== 'offset') add('info', 'Folding backup sights stay folded under the scope. 45° offset irons are the usual alternative.')
  if (lp) {
    const p = lp.pos ?? defaultPos(lp, I), mt = lp.mount ? cat.AB[lp.mount] : undefined
    if (p < I.railStart - 0.3) add('check', 'The scope overhangs the charging handle. Check you can reach the latch.')
    if (!mt) add('fail', `${sn(lp.n)} has no rings or mount chosen.`, 'Pick a 30 mm or 34 mm mount in Attachments.')
    else if (mt.for && mt.for !== 'lpvo') add('fail', `${mt.n} is a red-dot mount; it won't hold a scope tube.`)
    else add('ok', `${sn(lp.n)} on the ${sn(mt.n)} at a ${L(effH(cat, lp) + riserUnder(g, lp, I))} centreline.`)
  }
  if (dot && lp) add('info', 'A red dot and a magnified optic both on top: an offset dot is the usual alternative.')
  for (const a of g.atts.filter((x) => x.k === 'offset')) { if (!a.sub) add('check', `${sn(a.n)} has no dot chosen.`); else add('ok', `${sn(cat.AB[a.sub]?.n)} on a 45° offset (${cat.AB[a.sub]?.fp || 'RMR'} footprint).`) }
  for (const a of g.atts.filter((x) => x.k === 'pdot')) {
    if (!I.pistol) continue
    if (/rmr|optic|mos|cut|ready/i.test(ctx.slideText)) add('ok', `${sn(a.n)} (${a.fp || 'footprint not listed'}) on an optic-ready slide. Confirm the plate or cut matches.`)
    else add('check', `${sn(a.n)} uses the ${a.fp || 'unlisted'} footprint. Confirm the slide is cut or plated for it.`)
  }
  // ---- lights, lasers, handling
  for (const lgt of g.atts.filter((a) => a.k === 'light' || a.k === 'plight')) {
    if (I.pistol) { if (lgt.k === 'light') add('check', `${sn(lgt.n)} is a rifle light. Use a pistol light on a handgun.`); else add('ok', `${sn(lgt.n)} on the frame rail.`); continue }
    if (lgt.k === 'plight') add('info', `${sn(lgt.n)} is a pistol light. It fits a Picatinny section, but the switch may be awkward to reach.`)
    const p = lgt.pos ?? defaultPos(lgt, I)
    if (p + lgt.len > I.devEnd + 0.3) add('check', 'The light head is past the muzzle device: blast and fouling on the lens.')
    else if (p + lgt.len < I.hgEnd - 3) add('check', 'The light is far back on the rail, so the handguard may shadow the beam.')
    else add('ok', `${sn(lgt.n)} at ${lgt.clock || 12} o'clock, head ${L(Math.max(0, I.hgEnd - p - lgt.len))} behind the rail end.`)
    if (!g.atts.some((a) => a.k === 'switch') && (lgt.lm ?? 0) >= 1000) add('info', 'High-output light with no remote switch. A pressure pad helps with a support-hand grip.')
  }
  if (g.atts.filter((a) => a.k === 'vfg' || a.k === 'stop').length > 1) add('info', "More than one grip or hand stop on the rail. Check they don't crowd the light switch.")
  // ---- platform specifics
  if (g.platform === 'ar10') add('check', 'DPMS and Armalite AR-10 patterns differ. Confirm the handguard, mags and barrel nut are the right pattern.')
  if (ar && c.stock === 'none') add('ok', 'Pistol buffer tube with nothing attached to it.')
  if (g.caliber === '.300 BLK' && ['pmag10', 'pmag20', 'pmag30', 'pmag40', 'pmag45', 'drum', 'drum100'].includes(c.mag ?? '')) add('check', "Mark your .300 BLK magazines. A 5.56 round chambered in .300 BLK can blow the gun apart.")
  if (ctx.sinceClean >= ctx.cleanEvery) add('check', `${ctx.sinceClean.toLocaleString()} rounds since the last cleaning (every ${ctx.cleanEvery.toLocaleString()}).`)
  const order: Record<Level, number> = { fail: 0, check: 1, info: 2, ok: 3 }
  return out.sort((x, y) => order[x.lvl] - order[y.lvl])
}
