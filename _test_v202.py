"""v2.0.1 验证"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 1400}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5111/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(8000)
        # 4 chart 高度
        info = await page.evaluate("""() => {
            const charts = document.querySelectorAll('[_echarts_instance_]');
            return Array.from(charts).map(c => {
                const r = c.getBoundingClientRect();
                return { id: c.getAttribute('_echarts_instance_'), h: r.height, top: r.top };
            });
        }""")
        for i in info:
            print(f"  {i['id']}: h={i['h']:.0f} top={i['top']:.0f}")
        # 滚动到第 2 行
        await page.evaluate("() => window.scrollTo(0, 600)")
        await page.wait_for_timeout(1500)
        await page.screenshot(path="_shots14/v202_4charts.png", full_page=False)
        # 再放大热力图
        await page.evaluate("() => window.scrollTo(0, 720)")
        await page.wait_for_timeout(1000)
        await page.screenshot(path="_shots14/v202_heat.png", full_page=False)
        await browser.close()

asyncio.run(main())
