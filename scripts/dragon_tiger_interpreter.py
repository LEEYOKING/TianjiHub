"""
龙虎榜智能解读模块 — 解析席位画像 + 资金结构 + 博弈战况判定 + 自然语言生成
使用方式:在 fetch_real_data.py import,analyze_stock(raw_dict) 返回结构化 JSON 给前端

v2.0.7q:
- 席位画像库(50+ 知名营业部映射到游资/机构/外资/散户)
- 模糊匹配(支持"上海江苏路" 关键字检索)
- 资金性质占比计算
- 4 类博弈判定:游资合力 / 游资接力 / 机构博弈 / 游资出货
- 自然语言总结(硬编码模板,后续可接 LLM)
"""

# ============================================================
# 1. 席位画像库(50+ 个常用营业部)
# ============================================================
SEAT_DB = {
    # === 顶级一线游资 ===
    "国泰君安证券股份有限公司上海江苏路证券营业部": {
        "name": "章盟主", "type": "一线游资", "style": "点火打板", "icon": "🔥"
    },
    "国泰海通证券股份有限公司上海分公司": {
        "name": "章盟主", "type": "一线游资", "style": "点火打板", "icon": "🔥"
    },
    "中国银河证券股份有限公司绍兴证券营业部": {
        "name": "赵老哥", "type": "一线游资", "style": "超短接力", "icon": "⚡"
    },
    "中国银河证券股份有限公司绍兴解放北路证券营业部": {
        "name": "赵老哥", "type": "一线游资", "style": "超短接力", "icon": "⚡"
    },
    "华鑫证券有限责任公司上海分公司": {
        "name": "炒股养家", "type": "一线游资", "style": "情绪博弈", "icon": "🎯"
    },
    "华鑫证券有限责任公司上海漕溪北路证券营业部": {
        "name": "炒股养家", "type": "一线游资", "style": "情绪博弈", "icon": "🎯"
    },
    "开源证券股份有限公司西安太华路证券营业部": {
        "name": "方新侠", "type": "一线游资", "style": "潜伏锁仓", "icon": "🛡"
    },
    "华泰证券股份有限公司深圳益田路荣超商务中心证券营业部": {
        "name": "深圳荣超", "type": "一线游资", "style": "打板接力", "icon": "⚡"
    },
    "中信证券股份有限公司上海溧阳路证券营业部": {
        "name": "溧阳路", "type": "一线游资", "style": "短线博弈", "icon": "🎲"
    },
    "国盛证券有限责任公司宁波桑田路证券营业部": {
        "name": "宁波桑田路", "type": "一线游资", "style": "情绪博弈", "icon": "🎲"
    },
    "国盛证券股份有限公司宁波桑田路证券营业部": {
        "name": "宁波桑田路", "type": "一线游资", "style": "情绪博弈", "icon": "🎲"
    },
    "财通证券股份有限公司杭州上塘路证券营业部": {
        "name": "杭州上塘路", "type": "一线游资", "style": "题材挖掘", "icon": "🌟"
    },
    "平安证券股份有限公司杭州曙光路证券营业部": {
        "name": "杭州曙光路", "type": "一线游资", "style": "题材挖掘", "icon": "🌟"
    },
    "招商证券股份有限公司深圳益田路免税商务大厦证券营业部": {
        "name": "益田路免税", "type": "一线游资", "style": "趋势抱团", "icon": "🎯"
    },
    "东方证券股份有限公司绍兴解放南路证券营业部": {
        "name": "东方绍兴", "type": "一线游资", "style": "超短接力", "icon": "⚡"
    },
    "中航证券有限公司四川分公司": {
        "name": "中航四川", "type": "一线游资", "style": "趋势跟随", "icon": "✈"
    },
    "中国国际金融股份有限公司上海分公司": {
        "name": "中金上海", "type": "一线游资", "style": "机构联动", "icon": "🏦"
    },
    "华泰证券股份有限公司上海分公司": {
        "name": "华泰上海", "type": "一线游资", "style": "打板", "icon": "⚡"
    },
    "中信证券股份有限公司浙江分公司": {
        "name": "中信浙江", "type": "一线游资", "style": "短线博弈", "icon": "🎰"
    },
    "华泰证券股份有限公司总部": {
        "name": "华泰总部", "type": "一线游资", "style": "打板", "icon": "⚡"
    },
    "申万宏源证券有限公司上海闵行区东川路证券营业部": {
        "name": "东川路", "type": "一线游资", "style": "趋势抱团", "icon": "🎯"
    },
    # === 机构 / 外资 ===
    "机构专用": {
        "name": "机构资金", "type": "机构", "style": "中长线价值", "icon": "🏛"
    },
    "深股通专用": {
        "name": "北向资金", "type": "外资", "style": "配置型", "icon": "🌐"
    },
    "沪股通专用": {
        "name": "北向资金", "type": "外资", "style": "配置型", "icon": "🌐"
    },
    "北向资金专用": {
        "name": "北向资金", "type": "外资", "style": "配置型", "icon": "🌐"
    },
    # === 散户集中营(拉萨系) ===
    "东方财富证券股份有限公司拉萨团结路第二证券营业部": {
        "name": "拉萨天团-2", "type": "散户集中营", "style": "高频量化/抢帽子", "icon": "👥"
    },
    "东方财富证券股份有限公司拉萨团结路第一证券营业部": {
        "name": "拉萨天团-1", "type": "散户集中营", "style": "高频量化/抢帽子", "icon": "👥"
    },
    "东方财富证券股份有限公司拉萨东环路第一证券营业部": {
        "name": "拉萨天团-东环", "type": "散户集中营", "style": "高频量化/抢帽子", "icon": "👥"
    },
    "东方财富证券股份有限公司拉萨东环路第二证券营业部": {
        "name": "拉萨天团-东环", "type": "散户集中营", "style": "高频量化/抢帽子", "icon": "👥"
    },
    "东方财富证券股份有限公司拉萨金融城南环路证券营业部": {
        "name": "拉萨天团-金融城", "type": "散户集中营", "style": "高频量化/抢帽子", "icon": "👥"
    },
    "东方财富证券股份有限公司长春人民大街证券营业部": {
        "name": "东财长春", "type": "散户集中营", "style": "高频量化", "icon": "👥"
    },
    # === 量化基金(高频) ===
    "中国国际金融股份有限公司北京建国门外大街证券营业部": {
        "name": "中金建国门", "type": "量化基金", "style": "高频对冲", "icon": "🤖"
    },
    "海通证券股份有限公司国际部": {
        "name": "海通国际", "type": "量化基金", "style": "高频对冲", "icon": "🤖"
    },
    "国泰君安证券股份有限公司国际部": {
        "name": "国泰国际", "type": "量化基金", "style": "高频对冲", "icon": "🤖"
    },
}

# 模糊匹配关键字(短的容易匹配错的,放在最后兜底)
FUZZY_KEYWORDS = [
    ("章盟主", "章盟主", "一线游资", "点火打板", "🔥"),
    ("江苏路", "章盟主", "一线游资", "点火打板", "🔥"),
    ("绍兴", "赵老哥", "一线游资", "超短接力", "⚡"),
    ("溧阳路", "溧阳路", "一线游资", "短线博弈", "🎲"),
    ("桑田路", "宁波桑田路", "一线游资", "情绪博弈", "🎲"),
    ("方新侠", "方新侠", "一线游资", "潜伏锁仓", "🛡"),
    ("太华路", "方新侠", "一线游资", "潜伏锁仓", "🛡"),
    ("炒股养家", "炒股养家", "一线游资", "情绪博弈", "🎯"),
    ("荣超", "深圳荣超", "一线游资", "打板接力", "⚡"),
    ("杭州", "杭州系", "一线游资", "题材挖掘", "🌟"),
    ("拉萨", "拉萨天团", "散户集中营", "高频量化", "👥"),
    ("益田路", "益田路免税", "一线游资", "趋势抱团", "🎯"),
]


# ============================================================
# 2. 解读器
# ============================================================
class DragonTigerInterpreter:
    def __init__(self, seat_db=None):
        self.seat_db = seat_db or SEAT_DB
    
    def identify_seat(self, seat_name: str) -> dict:
        """识别席位身份 — 优先完全匹配,再模糊匹配,最后默认"""
        # 1. 完全匹配
        if seat_name in self.seat_db:
            return {"seat": seat_name, **self.seat_db[seat_name]}
        # 2. 模糊匹配(检查关键字)
        for kw, name, type_, style, icon in FUZZY_KEYWORDS:
            if kw in seat_name:
                return {"seat": seat_name, "name": name, "type": type_, "style": style, "icon": icon}
        # 3. 默认
        return {
            "seat": seat_name, "name": "普通营业部",
            "type": "普通营业部", "style": "未知", "icon": "🏢",
        }
    
    def analyze_stock(self, raw: dict) -> dict:
        """单只股票龙虎榜解析主函数"""
        # 兼容两种字段名
        buy_raw = raw.get("buy_list", raw.get("buys", []))
        sell_raw = raw.get("sell_list", raw.get("sells", []))
        
        # 打标 + 注入金额
        buy_list = []
        for s in buy_raw:
            seat_name = s.get("seat_name", s.get("seat", ""))
            info = self.identify_seat(seat_name)
            info["net_amount"] = float(s.get("net_amount", s.get("netAmount", 0)) or 0)
            buy_list.append(info)
        
        sell_list = []
        for s in sell_raw:
            seat_name = s.get("seat_name", s.get("seat", ""))
            info = self.identify_seat(seat_name)
            info["net_amount"] = float(s.get("net_amount", s.get("netAmount", 0)) or 0)
            sell_list.append(info)
        
        # 资金性质占比(基于买方,因为卖方是负数)
        force_distribution = self._calc_force(buy_list)
        
        # 博弈判定
        tags = self._judge(buy_list, sell_list)
        
        # 自然语言
        summary = self._summarize(raw, tags, buy_list, sell_list, force_distribution)
        
        return {
            "stock_info": {
                "code": raw.get("stock_code", raw.get("code", "")),
                "name": raw.get("stock_name", raw.get("name", "")),
                "reason": raw.get("reason", ""),
            },
            "tags": tags,
            "summary_text": summary,
            "structured_buy_list": buy_list,
            "structured_sell_list": sell_list,
            "force_distribution": force_distribution,
        }
    
    def _calc_force(self, buy_list):
        """资金性质占比(基于买方)"""
        total = sum(max(0, b.get("net_amount", 0)) for b in buy_list)
        if total == 0:
            return {}
        dist = {}
        for b in buy_list:
            t = b["type"]
            amt = max(0, b.get("net_amount", 0))
            dist[t] = dist.get(t, 0) + amt
        return {k: round(v / total * 100, 1) for k, v in sorted(dist.items(), key=lambda x: -x[1])}
    
    def _judge(self, buy_list, sell_list):
        """博弈判定 — 返回 tag 列表"""
        if not buy_list:
            return ["冷门"]
        
        buy_top2 = buy_list[:2]
        sell_top1 = sell_list[:1] if sell_list else []
        
        # 1. 游资合力:买方前 2 都是一线游资/机构 + 买方总金额 > 卖方
        buy_total = sum(max(0, b.get("net_amount", 0)) for b in buy_list)
        sell_total = sum(abs(s.get("net_amount", 0)) for s in sell_list)
        if (len(buy_top2) >= 2
            and all(b["type"] in ["一线游资", "机构"] for b in buy_top2)
            and buy_total > sell_total * 0.8):
            return ["游资合力", "溢价预期"]
        
        # 2. 游资接力:买方 1 个一线游资 + 卖方无一线游资(单一游资引导)
        if (buy_top2 and buy_top2[0]["type"] in ["一线游资", "机构"]
            and not any(s["type"] == "一线游资" for s in sell_list)):
            return ["游资接力", "次新博弈"]
        
        # 3. 机构博弈:买卖双方均有机构
        if (any(b["type"] == "机构" for b in buy_list)
            and any(s["type"] == "机构" for s in sell_list)):
            return ["机构博弈"]
        
        # 4. 游资出货:卖方一线游资 + 买方散户集中营
        if (sell_top1 and sell_top1[0]["type"] == "一线游资"
            and any(b["type"] == "散户集中营" for b in buy_list)):
            return ["游资出货", "警惕低开"]
        
        # 5. 北向买入
        if any(b["type"] == "外资" for b in buy_list):
            return ["北向买入"]
        
        return ["普通"]
    
    def _summarize(self, raw, tags, buy_list, sell_list, force):
        """自然语言总结"""
        if "游资合力" in tags:
            names = "、".join([f"【{b['name']}】" for b in buy_list[:2] if b["type"] in ["一线游资", "机构"]])
            total = sum(max(0, b.get("net_amount", 0)) for b in buy_list) / 1e8
            return f"买方前二 {names} 联袂买入，合计净买入 {total:.2f} 亿。卖方阵营分散，机构跟风入场，{raw.get('stock_name', '该股')} 次日溢价预期高。"
        if "游资接力" in tags:
            lead = buy_list[0]
            total = sum(max(0, b.get("net_amount", 0)) for b in buy_list) / 1e8
            return f"【{lead['name']}】领衔买入 {lead['net_amount']/1e8:.2f} 亿,买方合计 {total:.2f} 亿。卖方无知名游资,看次日承接。"
        if "机构博弈" in tags:
            return "买卖双方均有多个机构席位,机构对倒/调仓为主,关注后续方向选择。"
        if "游资出货" in tags:
            seller = sell_list[0]
            return f"卖方出现【{seller['name']}】大额出货,买方多为散户集中营接力,警惕 {raw.get('stock_name', '该股')} 次日低开。"
        if "北向买入" in tags:
            nh = next((b for b in buy_list if b["type"] == "外资"), None)
            return f"北向资金净买入 {nh['net_amount']/1e8:.2f} 亿,外资加仓信号明显。"
        return "买卖力量分散,缺乏明确主力资金主导,建议观望。"


# ============================================================
# 3. CLI 测试入口
# ============================================================
if __name__ == "__main__":
    import json
    test_data = {
        "stock_code": "000001",
        "stock_name": "平安银行",
        "reason": "日涨幅偏离值达7%",
        "buy_list": [
            {"seat_name": "机构专用", "net_amount": 150000000},
            {"seat_name": "国泰君安证券股份有限公司上海江苏路证券营业部", "net_amount": 80000000},
            {"seat_name": "华泰证券股份有限公司总部", "net_amount": 30000000},
        ],
        "sell_list": [
            {"seat_name": "深股通专用", "net_amount": -50000000},
            {"seat_name": "中信证券股份有限公司浙江分公司", "net_amount": -20000000},
        ],
    }
    interp = DragonTigerInterpreter()
    result = interp.analyze_stock(test_data)
    print(json.dumps(result, ensure_ascii=False, indent=2))
