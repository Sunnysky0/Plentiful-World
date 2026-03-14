version="0.1"
tags={
	"Alternative History"
	"Map"
	"Events"
	"Gameplay"
}
name="Plentiful World"
picture="thumbnail.png"
supported_version="1.17.*"

# --- 核心逻辑清理 --- 
replace_path = "events"                  # 清空所有原版事件 
replace_path = "common/decisions"        # 清空原版决议 
replace_path = "common/decisions/categories" # 清空决议分类（建议加上，防止残留） 
replace_path = "common/national_focus"   # 清空原版国策树（所有国家将变为无国策或通用国策） 

# --- AI 与 机制清理 --- 
replace_path = "common/ai_strategy"      # 清空AI的大战略倾向 
replace_path = "common/ai_strategy_plans" # 清空AI的具体执行计划（如德国闪击波兰的流程） 
replace_path = "common/on_actions"       # 清空自动触发逻辑（非常重要，否则会有原版选举、随机事件干扰） 
replace_path = "common/ideas"            # 清空民族精神、内阁顾问、法案（*注意：会导致法案页空白） 

# --- 历史与军队清理 --- 
replace_path = "history/countries"       # 清空各国开局设定（政党、科技、首都位置） 
replace_path = "history/units"           # 清空开局军队（OOB），否则原版德军会出现在地图上 

# --- 脚本逻辑清理 (可选，视改动深度而定) --- 
replace_path = "common/scripted_effects" # 清空脚本效果 
replace_path = "common/scripted_triggers" # 清空脚本触发器 

# --- 额外清理以防止崩溃 ---
replace_path = "common/military_industrial_organization" # 清空原版 MIO，防止引用不存在的顾问导致崩溃
replace_path = "common/technologies" # 清空原版全部科技，为新科技体系提供白板
replace_path = "gfx/loadingscreens" # 完全覆盖原版/ DLC 加载背景图
