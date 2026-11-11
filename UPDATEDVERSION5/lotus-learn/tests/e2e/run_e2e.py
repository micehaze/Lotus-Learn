"""End-to-end browser test for Lotus Learn (Playwright + Chromium).
Starts a fresh server on a temporary database, drives the real UI, saves screenshots
to tests/e2e/screenshots and fails on uncaught page errors.
Usage: python3 tests/e2e/run_e2e.py   (needs: pip install playwright && playwright install chromium)"""
import os, sys, time, sqlite3, subprocess, tempfile, signal, pathlib
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[2]
SHOTS = ROOT / 'tests' / 'e2e' / 'screenshots'; SHOTS.mkdir(parents=True, exist_ok=True)
DB = os.path.join(tempfile.mkdtemp(), 'e2e.db')
PORT = os.environ.get('E2E_PORT', '3999')
BASE = f'http://127.0.0.1:{PORT}'
env = dict(os.environ, LOCAL_DICT_ENABLED='false', DATABASE_FILE=DB, PORT=PORT, HOST='127.0.0.1', AUTOMATION_ENABLED='false', DAILY_TOPIC_ENABLED='false', SEED_DEMO_USER='true', PUBLIC_URL=BASE)
server = subprocess.Popen(['node', '--disable-warning=ExperimentalWarning', 'server/index.js'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
errors, steps = [], []
def step(name): steps.append(name); print('  ✓', name, flush=True)
def shot(page, name): page.screenshot(path=str(SHOTS / f'{name}.png'), full_page=False)
def correct_answer(qid):
    con = sqlite3.connect(DB); r = con.execute('select correct_answer from learning_questions where id=?', (qid,)).fetchone(); con.close(); return r[0]

try:
    for _ in range(60):
        try:
            import urllib.request; urllib.request.urlopen(BASE + '/api/health', timeout=1); break
        except Exception: time.sleep(0.25)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1366, 'height': 820})
        page = ctx.new_page()
        IGNORE = ('fonts.googleapis', 'fonts.gstatic', 'ytimg', 'youtube', 'ERR_NAME_NOT_RESOLVED', 'ERR_INTERNET_DISCONNECTED', 'net::ERR', 'Failed to load resource')
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' and not any(s in m.text for s in IGNORE) else None)

        page.goto(BASE + '/'); page.wait_for_selector('.hero__logo'); page.wait_for_timeout(1500)
        assert page.locator('#scene.scene--live canvas').count() == 1, 'live water canvas should be running on the landing page'
        shot(page, '01-landing'); step('landing page with live animated lagoon')

        page.click('text=Start learning'); page.fill('input[name=displayName]', 'Asha'); page.fill('input[name=email]', 'asha@example.com'); page.fill('input[name=password]', 'lotus-pass-123')
        page.click('button[type=submit]'); page.wait_for_url('**/onboarding'); page.wait_for_selector('input[name=level]')
        shot(page, '02-onboarding')
        page.check('input[name=level][value=A1]'); page.click('label.chip:has-text("Nature")'); page.click('label.chip:has-text("Food and cooking")')
        page.click('text=Start learning'); page.wait_for_url('**/home'); page.wait_for_selector('text=Daily Topic'); page.wait_for_timeout(1200)
        assert page.evaluate("document.body.dataset.theme") == 'ta', 'Tamil theme applied after sign-in'
        shot(page, '03-home-tamil-theme'); step('registration, onboarding, logged-in home')

        page.click('nav >> text=Vocabulary'); page.wait_for_selector('.wcard'); page.wait_for_timeout(500); shot(page, '04-vocabulary')
        page.locator('[data-save]').first.click(); page.wait_for_selector('.modal'); page.fill('input[name=title]', 'E2E words'); page.click('.modal button[type=submit]')
        page.wait_for_selector('.toast'); step('vocabulary browse + save to new collection')

        page.goto(BASE + '/dictionary?q=thanneer&direction=to_en'); page.wait_for_selector('text=transliteration'); page.wait_for_timeout(500); shot(page, '05-dictionary-translit')
        page.locator('.win__foot [data-save]').first.click(); page.wait_for_selector('.modal select'); page.click('.modal button[type=submit]'); page.wait_for_selector('.toast')
        page.goto(BASE + '/dictionary?q=' + 'पानी'); page.wait_for_selector('text=exact Hindi')
        page.goto(BASE + '/dictionary?q=' + 'വെള്ളം'); page.wait_for_selector('text=Malayalam equivalent')
        page.goto(BASE + '/dictionary?q=watr'); page.wait_for_selector('text=fuzzy English')
        page.goto(BASE + '/dictionary?q=zzqqxx'); page.wait_for_selector('text=No translation found'); step('dictionary: transliteration, Hindi, Malayalam, fuzzy, not-found')

        page.click('nav >> text=Collections'); page.wait_for_selector('text=E2E words'); page.click('a.btn:has-text("Open")')
        page.wait_for_selector('[data-addword]'); page.click('[data-addword]')
        page.fill('.modal input[name=tamil]', 'கோயில்'); page.fill('.modal input[name=english]', 'temple'); page.fill('.modal input[name=exampleTa]', 'இது ஒரு பெரிய கோயில்.'); page.fill('.modal input[name=exampleEn]', 'This is a big temple.')
        page.click('.modal button[type=submit]'); page.wait_for_selector('.wcard:has-text("கோயில்")'); page.wait_for_timeout(300); shot(page, '06-collection')
        step('collection detail + manual word')

        page.click('[data-study]'); page.wait_for_url('**/study'); page.wait_for_selector('.wcard--selected'); page.wait_for_timeout(400); shot(page, '07-study-selection')
        page.click('[data-start]'); page.wait_for_url('**/learn/*'); page.wait_for_selector('.opt')
        page.wait_for_timeout(300); shot(page, '08-question')
        made_mistake = False
        for i in range(80):
            if '/done' in page.url: break
            page.wait_for_selector('.opt:not([disabled])', timeout=8000)
            qid = page.evaluate("fetch(location.pathname.replace('/learn/','/api/sessions/')+'/question').then(r=>r.json()).then(d=>d.question&&d.question.id)")
            if not qid: break
            ans = correct_answer(qid)
            opts = page.locator('.opt'); n = opts.count()
            texts = [opts.nth(k).locator('span').nth(1).inner_text() for k in range(n)]
            idx = texts.index(ans)
            if not made_mistake:
                wrong = (idx + 1) % n; opts.nth(wrong).click(); page.wait_for_selector('.feedback--bad'); shot(page, '09-wrong-feedback'); made_mistake = True
                page.click('[data-next]'); continue
            opts.nth(idx).click()
            page.wait_for_timeout(120)
            if page.locator('text=Lesson complete!').count(): break
            page.wait_for_function("() => !document.querySelector('.opt') || document.querySelectorAll('.opt:disabled').length === 0", timeout=8000)
        page.wait_for_url('**/done', timeout=10000); page.wait_for_selector('text=Excellent!'); page.wait_for_timeout(1400); shot(page, '10-lesson-complete')
        assert page.locator('text=Lesson completed!').count() == 1
        step('learning session: wrong answer feedback, 30 correct answers, completion with lotus rewards')
        page.click('text=Lesson Statistics'); page.wait_for_selector('.chart svg'); page.wait_for_timeout(700); shot(page, '11-lesson-stats'); step('lesson histogram')

        page.goto(BASE + '/collections'); page.locator('a[href$="/stats"]').first.click(); page.wait_for_selector('svg[aria-label="Word mastery radar"]'); page.wait_for_timeout(600); shot(page, '12-collection-radar')
        page.goto(BASE + '/statistics'); page.wait_for_selector('text=Last 30 days'); page.wait_for_timeout(500); shot(page, '13-statistics'); step('collection radar + global statistics')

        page.click('nav >> text=Reading'); page.wait_for_selector('text=Read'); shot(page, '14-reading')
        page.locator('a.btn:has-text("Read")').first.click(); page.wait_for_selector('.reader .w'); page.locator('.reader .w').nth(1).click(); page.wait_for_selector('.popover .btn'); page.wait_for_timeout(300)
        shot(page, '15-reader-lookup'); page.keyboard.press('Escape')
        page.check('[data-tog=en]'); expect(page.locator('.para-en').first).to_be_visible(); step('reader with lookups and translation toggle')

        page.click('nav >> text=Videos'); page.wait_for_selector('text=video shelf is empty'); shot(page, '16-videos-empty'); step('video library empty state')
        page.click('nav >> text=Profile'); page.wait_for_selector('text=Profile picture'); shot(page, '17-profile')

        # ---------------- multilingual: Daily Topic, grammar, notes, live updates, four themes
        page.click('nav >> text=Daily Topic'); page.wait_for_selector('text=Today’s topic is being prepared'); shot(page, '25-daily-topic')
        page.get_by_role('link', name='Topic archive').click(); page.wait_for_selector('.daily-calendar')
        expect(page.get_by_text('No topics match.')).to_be_visible()
        page.click('nav >> text=Grammar'); page.wait_for_selector('text=Categories'); page.locator('a.wcard').first.click(); page.wait_for_selector('text=Rule'); page.wait_for_timeout(600); shot(page, '26-grammar-lesson')
        page.click('[data-bm]'); page.wait_for_selector('text=★ Bookmarked')
        page.click('nav >> text=Learning Notes'); page.wait_for_selector('.cal'); page.click('[data-new]')
        page.fill('.note-card [name=title]', 'Dative case'); page.fill('.note-card [name=body]', 'எனக்குத் தண்ணீர் வேண்டும் — **I want water**')
        [page.wait_for_timeout(250) for _ in range(40) if not page.text_content('.note-card .save-state').startswith('Saved ')]
        assert page.text_content('.note-card .save-state').startswith('Saved '), 'note autosaved'; page.wait_for_timeout(400); shot(page, '27-notes-calendar')
        page.reload(); page.wait_for_selector('.note-card [name=body]'); assert 'தண்ணீர்' in page.input_value('.note-card [name=body]'), 'note persists after reload'
        step('Daily Topic, grammar lesson + bookmark, Learning Notes autosave + persistence')
        # live update: keep the learner on Grammar, publish a lesson from an admin session
        page.click('nav >> text=Grammar'); page.wait_for_selector('text=Categories'); page.wait_for_timeout(800)
        actx = browser.new_context(); ap = actx.new_page(); ap.goto(BASE + '/login')
        ap.fill('input[name=email]', 'admin@lotuslearn.local'); ap.fill('input[name=password]', 'lotus-admin-2026'); ap.click('button[type=submit]'); ap.wait_for_url('**/home')
        r = ap.evaluate('''async () => { const h = {'content-type':'application/json','x-requested-with':'lotus'};
          const c = await fetch('/api/admin/grammar', {method:'POST', headers:h, body: JSON.stringify({lang:'ta', category:'pronouns', level:'A1', title:'Live update test: நீ and நீங்கள்', rule:'நீ is informal you; நீங்கள் is respectful or plural you.', examples:[{native:'நீ எங்கே போகிறாய்?', en:'Where are you going? (informal)'},{native:'நீங்கள் எங்கே போகிறீர்கள்?', en:'Where are you going? (respectful)'}]})}).then(r=>r.json());
          await fetch('/api/admin/grammar/'+c.id+'/status', {method:'POST', headers:h, body: JSON.stringify({status:'published'})}); return c.id; }''')
        page.wait_for_selector('text=Live update test', timeout=8000)
        step('new content appears in an open tab without a manual refresh (server-sent events)')
        actx.close()
        themes = {}
        for code, name in [('ml', 'Malayalam'), ('kn', 'Kannada'), ('te', 'Telugu')]:
            page.click(f'[data-lang={code}]'); page.wait_for_url('**/onboarding')
            page.check('input[name=level][value=A2]'); page.click('[data-onb] button[type=submit]'); page.wait_for_url('**/home'); page.wait_for_selector('text=Daily Topic')
            page.wait_for_timeout(1500)
            assert page.evaluate('document.body.dataset.theme') == code
            assert page.locator('#scene.scene--live canvas').count() == 1, f'{name} scene animates'
            themes[code] = page.evaluate('getComputedStyle(document.body).getPropertyValue("--salmon").trim()')
            shot(page, f'28-home-{code}-theme')
        page.click('nav >> text=Dictionary'); page.fill('[data-dict] input[name=q]', 'water'); page.click('[data-dict] button[type=submit]'); page.wait_for_selector('text=In other languages'); page.wait_for_timeout(600); shot(page, '29-dictionary-telugu')
        page.click('nav >> text=Collections'); page.wait_for_selector('text=My Telugu collections'); assert page.locator('text=E2E words').count() == 0, 'Tamil collection hidden in Telugu'
        page.click('[data-lang=ml]'); page.goto(BASE + '/reading'); page.wait_for_selector('text=Malayalam reading library'); page.wait_for_timeout(900); shot(page, '30-reading-malayalam')
        page.click('[data-lang=ta]'); page.wait_for_timeout(500); page.goto(BASE + '/collections'); page.wait_for_selector('text=E2E words')
        assert len(set(themes.values())) == 3, 'each language has distinct theme tokens'
        step('four themes (Tamil, Malayalam, Kannada, Telugu), per-language onboarding, collection isolation, Tamil data intact after switching')
        page.click('nav >> text=Settings'); page.check('input[name=motion][value=off]'); page.click('text=Save interface settings'); page.wait_for_selector('.toast')
        page.goto(BASE + '/home'); page.wait_for_selector('text=Daily Topic'); page.wait_for_timeout(500)
        assert page.locator('#scene.scene--still').count() == 1, 'motion off must show the static scene'
        step('settings: animation switched off -> static scenery')

        # mobile
        m = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        m.add_cookies(ctx.cookies()); mp = m.new_page(); mp.on('pageerror', lambda e: errors.append(f'mobile pageerror: {e}'))
        mp.goto(BASE + '/home'); mp.wait_for_selector('.win__title >> text=Daily Topic'); mp.wait_for_timeout(400); shot(mp, '18-mobile-home')
        mp.click('[data-menu]'); mp.wait_for_selector('.navbar.open'); shot(mp, '19-mobile-menu')
        mp.goto(BASE + '/dictionary?q=house&direction=from_en'); mp.wait_for_selector('text=exact English'); shot(mp, '20-mobile-dictionary')
        overflow = mp.evaluate('document.documentElement.scrollWidth > innerWidth + 1'); assert not overflow, 'no horizontal page overflow on mobile'
        tablet = browser.new_context(viewport={'width': 820, 'height': 1180}); tablet.add_cookies(ctx.cookies()); tp = tablet.new_page()
        tp.goto(BASE + '/collections'); tp.wait_for_selector('text=E2E words'); shot(tp, '21-tablet-collections')
        step('mobile + tablet layouts (menu, no horizontal overflow)')

        # admin
        page.click('[data-logout]'); page.wait_for_url(BASE + '/'); page.goto(BASE + '/login')
        page.fill('input[name=email]', 'admin@lotuslearn.local'); page.fill('input[name=password]', 'lotus-admin-2026'); page.click('button[type=submit]'); page.wait_for_url('**/home')
        page.goto(BASE + '/admin'); page.wait_for_selector('text=Automation'); page.wait_for_timeout(500); shot(page, '22-admin-overview')
        page.goto(BASE + '/admin/jobs'); page.click('[data-run=vocabulary]'); page.wait_for_selector('.status-failed'); page.wait_for_timeout(600); shot(page, '23-admin-jobs')
        page.goto(BASE + '/admin/videos'); page.fill('input[name=url]', 'https://www.youtube.com/watch?v=aaaaaaaaaaa'); page.fill('input[name=title]', 'E2E test video'); page.click('[data-add] button[type=submit]')
        page.wait_for_selector('.toast'); page.goto(BASE + '/admin/review'); page.wait_for_selector('text=E2E test video'); page.click('[data-act^="videos:"][data-act$=":published"]'); page.wait_for_selector('.toast')
        page.goto(BASE + '/videos'); page.wait_for_selector('text=E2E test video'); page.click('text=E2E test video'); page.wait_for_selector('iframe[src*="youtube-nocookie.com/embed/aaaaaaaaaaa"]')
        page.click('[data-fav]'); page.wait_for_selector('text=★ Favourite'); step('admin: overview, failed AI job surfaced, video add → review → publish → learner embed + favourite')
        page.goto(BASE + '/admin/vocabulary'); page.wait_for_selector('text=Mark native-reviewed'); page.wait_for_timeout(500); shot(page, '24-admin-vocabulary')
        page.goto(BASE + '/admin/stories'); page.wait_for_selector('text=Add story'); page.goto(BASE + '/admin/settings'); page.wait_for_selector('text=Maximum words per collection')
        page.goto(BASE + '/admin/taxonomy'); page.wait_for_selector('text=Levels'); page.goto(BASE + '/admin/import'); page.wait_for_selector('text=CSV columns'); page.goto(BASE + '/admin/users'); page.wait_for_selector('text=asha@example.com')
        step('admin: vocabulary, stories, settings, taxonomy, import, users')
        browser.close()
finally:
    server.send_signal(signal.SIGTERM)
    try: out = server.communicate(timeout=5)[0]
    except Exception: server.kill(); out = ''

print(f'\n{len(steps)} e2e steps passed')
if errors:
    print('Browser errors:'); [print('  ', e) for e in errors]; sys.exit(1)
print('No page errors.')
