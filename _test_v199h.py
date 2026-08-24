"""patch echarts 拿到 series 数据"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        # 提前注入 patch — hook echarts init
        await page.add_init_script("""
            (function() {
                const orig = window.echarts;
                Object.defineProperty(window, 'echarts', {
                    set(v) {
                        const init = v && v.init;
                        if (init) {
                            v.init = function(dom, theme, opts) {
                                const inst = init.call(this, dom, theme, opts);
                                const origSet = inst.setOption.bind(inst);
                                inst.setOption = function(opt, n) {
                                    try {
                                        const series = (opt.series || []).map(s => ({
                                            name: s.name, data: s.data,
                                        }));
                                        const xData = (opt.xAxis && opt.xAxis[0] && opt.xAxis[0].data) || [];
                                        const title = (opt.title && opt.title[0] && opt.title[0].text) || '';
                                        window.__chartData = window.__chartData || [];
                                        window.__chartData.push({ title, xData, series });
                                    } catch(e) {}
                                    return origSet(opt, n);
                                };
                                return inst;
                            };
                        }
                        Object.defineProperty(window, 'echarts', { value: v, writable: true, configurable: true });
                    },
                    get() { return undefined; },
                    configurable: true,
                });
            })();
        """)
        await page.goto("http://localhost:5092/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)
        data = await page.evaluate("() => window.__chartData || []")
        for c in data[:6]:
            print(f'chart: {c["title"][:30]}')
            print(f'  xData: {c["xData"]}')
            for s in c['series']:
                print(f'  {s["name"]}: {s["data"][-5:] if s["data"] else "[]"}')
            print()
        await browser.close()

asyncio.run(main())
