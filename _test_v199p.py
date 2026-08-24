"""看 React 组件 props 拿 history"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5093/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(10000)
        # 找 echarts 实例通过 react fiber
        result = await page.evaluate("""() => {
            const allDivs = document.querySelectorAll('div[_echarts_instance_]');
            const out = [];
            for (const d of allDivs) {
                const id = d.getAttribute('_echarts_instance_');
                // 走 React fiber
                const reactKey = Object.keys(d).find(k => k.startsWith('__reactFiber'));
                if (reactKey) {
                    let fiber = d[reactKey];
                    while (fiber) {
                        if (fiber.memoizedProps && fiber.memoizedProps.option) {
                            const opt = fiber.memoizedProps.option;
                            out.push({
                                id,
                                xData: (opt.xAxis && opt.xAxis[0] && opt.xAxis[0].data) || [],
                                seriesData: ((opt.series || []).map(s => s.data) || []).slice(0, 2),
                            });
                            break;
                        }
                        fiber = fiber.return;
                    }
                }
            }
            return out;
        }""")
        for r in result:
            print(f'--- {r["id"]} ---')
            print(f'  x: {r["xData"]}')
            print(f'  series[0]: {r["seriesData"][0] if r["seriesData"] else "[]"}')
        await browser.close()

asyncio.run(main())
