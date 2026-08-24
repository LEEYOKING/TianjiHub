"""看 history 实际渲染"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5092/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(6000)
        # 用 React DevTools hook 拿 state
        result = await page.evaluate("""() => {
            // 找 echarts 实例
            const divs = document.querySelectorAll('[_echarts_instance_]');
            const out = [];
            for (const d of divs) {
                const inst = window.echarts?.getInstanceByDom?.(d);
                if (inst) {
                    const opt = inst.getOption();
                    const series = opt.series || [];
                    out.push({
                        title: (opt.title && opt.title[0] && opt.title[0].text) || '',
                        seriesNames: series.map(s => s.name),
                        xData: (opt.xAxis && opt.xAxis[0] && opt.xAxis[0].data) || [],
                        lastY: series.map(s => (s.data || []).slice(-5)),
                    });
                }
            }
            return out;
        }""")
        for c in result:
            print(f'chart: {c.get("title", "")}')
            print(f'  xData: {c.get("xData", [])}')
            print(f'  last 5: {c.get("lastY", [])}')
        await browser.close()

asyncio.run(main())
