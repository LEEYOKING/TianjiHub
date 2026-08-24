"""量 treemap cell 实际尺寸"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 1400}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5101/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(8000)
        # 抓 treemap cell 的 svg rect/rect/text 节点
        result = await page.evaluate("""() => {
            // treemap 用 canvas 渲染的,没 svg
            // 用 echarts instance 取 series
            const divs = document.querySelectorAll('[_echarts_instance_]');
            for (const d of divs) {
                const id = d.getAttribute('_echarts_instance_');
                const reactKey = Object.keys(d).find(k => k.startsWith('__reactFiber'));
                if (reactKey) {
                    let f = d[reactKey];
                    while (f) {
                        if (f.memoizedProps && f.memoizedProps.option && f.memoizedProps.option.series) {
                            const opt = f.memoizedProps.option;
                            const series = opt.series && opt.series[0];
                            if (series && series.type === 'treemap') {
                                return {
                                    id,
                                    data: series.data.map(x => ({ name: x.name, value: x.value, avgPct: x.avgPct, color: x.itemStyle?.color })),
                                    height: series.height,
                                    width: series.width,
                                };
                            }
                        }
                        f = f.return;
                    }
                }
            }
            return null;
        }""")
        if result:
            print(f"treemap {result['id']}:")
            print(f"  size: {result['width']}x{result['height']}")
            print(f"  data({len(result['data'])} 个):")
            for d in result['data']:
                print(f"    {d['name']}: {d['avgPct']:+.2f}% weight={d['value']:.0f}")
        await browser.close()

asyncio.run(main())
