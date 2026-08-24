"""console.log + console 注入 debug"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        msgs = []
        page.on("console", lambda m: msgs.append((m.type, m.text)))
        # 注入全局 hook — fetch data.json 后存到 window
        await page.add_init_script("""
            (function() {
                const orig = window.fetch;
                window.fetch = function(...args) {
                    const url = String(args[0]);
                    return orig.apply(this, args).then(r => {
                        if (url.includes('data.json')) {
                            r.clone().text().then(t => {
                                try {
                                    const d = JSON.parse(t);
                                    window.__rawHistory = d.history;
                                    console.log('PUSH_FETCH_HISTORY', JSON.stringify(d.history.slice(-3)));
                                } catch(e){}
                            });
                        }
                        return r;
                    });
                };
            })();
        """)
        await page.goto("http://localhost:5092/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(10000)
        for t, msg in msgs:
            if 'HISTORY' in msg or 'PUSH' in msg:
                print(f'  [{t}] {msg[:300]}')
        raw = await page.evaluate("() => window.__rawHistory || []")
        if raw:
            print(f'  raw fetch last 3: {raw[-3:]}')
        # 抓 echarts 实例取 history 实际渲染值
        chart = await page.evaluate("""() => {
            const divs = document.querySelectorAll('[_echarts_instance_]');
            for (const d of divs) {
                const k = d.getAttribute('_echarts_instance_');
                if (k && window.echarts) {
                    const inst = window.echarts.getInstanceById(k);
                    if (inst) {
                        const opt = inst.getOption();
                        return {
                            x: (opt.xAxis && opt.xAxis[0] && opt.xAxis[0].data) || [],
                            y: ((opt.series && opt.series[0] && opt.series[0].data) || []).slice(-7),
                        };
                    }
                }
            }
            return null;
        }""")
        print(f'  chart actual: {chart}')
        await browser.close()

asyncio.run(main())
