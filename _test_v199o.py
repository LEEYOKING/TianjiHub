"""patch echarts setOption"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        # patch echarts 走 setOption
        await page.add_init_script("""
            (function() {
                let captured = [];
                const wait = setInterval(() => {
                    if (window.__echarts_patched) return;
                    const all = document.querySelectorAll('script');
                    for (const s of all) {
                        if ((s.textContent || '').includes('echarts') || s.src.includes('index-')) {
                            // 等模块加载
                        }
                    }
                }, 50);
            })();
        """)
        # 用 add_init_script 在 module 加载前拦截 — 但 echarts 是 ES module, 不在 window
        # 改用:在每个 ReactECharts 渲染时
        await page.goto("http://localhost:5092/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(8000)
        # 找 echarts instance (用 ReactEcharts 把 echarts 实例挂到 div)
        result = await page.evaluate("""() => {
            // 尝试所有 div
            const allDivs = document.querySelectorAll('div[_echarts_instance_]');
            const out = [];
            for (const d of allDivs) {
                const id = d.getAttribute('_echarts_instance_');
                // 通过 react-echarts 拿
                const reactKey = Object.keys(d).find(k => k.startsWith('__reactFiber'));
                out.push({id, hasReact: !!reactKey, w: d.clientWidth, h: d.clientHeight, text: d.textContent.slice(0, 200)});
            }
            return out;
        }""")
        for r in result:
            print(r)
        # 直接读 svg 文本
        svgs = await page.evaluate("""() => {
            const out = [];
            for (const s of document.querySelectorAll('svg')) {
                const txt = s.textContent || '';
                if (txt.match(/08-\d/)) {
                    out.push(txt);
                }
            }
            return out;
        }""")
        for i, s in enumerate(svgs):
            print(f'--- SVG #{i} ---')
            print(s)
        await browser.close()

asyncio.run(main())
