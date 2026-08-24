"""注入 React DevTools 拿到合并后 history"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/root/.cache/ms-playwright/chromium-1223/chrome-linux/chrome", headless=True, args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Shanghai")
        page = await ctx.new_page()
        # 抓 console
        msgs = []
        page.on("console", lambda m: msgs.append(f'  [{m.type}] {m.text}'))
        # 注入 patch 在 fetch data.json 后打印 history
        await page.add_init_script("""
            (function() {
                const orig = window.fetch;
                window.fetch = function(...args) {
                    return orig.apply(this, args).then(r => {
                        const url = r.url || '';
                        if (url.includes('data.json')) {
                            r.clone().text().then(t => {
                                const d = JSON.parse(t);
                                console.log('FETCH_HISTORY:', JSON.stringify(d.history.slice(-3)));
                            });
                        }
                        return r;
                    });
                };
            })();
        """)
        await page.goto("http://localhost:5092/overview", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(8000)
        for m in msgs[-15:]:
            print(m)
        await browser.close()

asyncio.run(main())
