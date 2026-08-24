"""v2.0 截图 4 卡片高度验证"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        await page.goto("http://localhost:5095/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(8000)
        # 量 4 个 chart card 实际高度
        heights = await page.evaluate("""() => {
            const cards = document.querySelectorAll('.overview-chart-card, [class*="overview-chart"]');
            const out = [];
            // 找 4 个 Card 父 div
            const titles = ['成交量(亿)', '涨/跌家数', '涨/跌停家数', '市场涨跌幅热力图'];
            for (const t of titles) {
                for (const div of document.querySelectorAll('div')) {
                    if ((div.textContent || '').trim().startsWith(t + ' 7日') || (div.textContent || '').trim().startsWith(t) && div.querySelector('[_echarts_instance_]')) {
                        const card = div.closest('div[class*="card"]') || div.parentElement;
                        if (card) {
                            const rect = card.getBoundingClientRect();
                            out.push({ title: t, h: rect.height, w: rect.width });
                        }
                        break;
                    }
                }
            }
            return out;
        }""")
        for h in heights:
            print(f"  {h['title']}: h={h['h']:.0f} w={h['w']:.0f}")
        await page.screenshot(path="_shots14/v200_4charts.png", full_page=True)
        await browser.close()

asyncio.run(main())
