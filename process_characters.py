import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
JSON_PATH = ROOT / "characters.json"
CHAR_PATH = ROOT / "common" / "characters" / "CHI_extra.txt"
COUNTRY_TRAIT_PATH = ROOT / "common" / "country_leader" / "CHI_extra_traits.txt"
UNIT_TRAIT_PATH = ROOT / "common" / "unit_leader_traits" / "CHI_extra_traits.txt"
GFX_PATH = ROOT / "interface" / "CHI_extra.gfx"


def cid(name_en: str) -> str:
    return f"CHI_{name_en}"


def trait_id(name_en: str) -> str:
    return f"trait_CHI_{name_en}"


def fmt_value(v):
    if isinstance(v, str):
        return v
    return str(v)


def write_character_block(entry):
    name_en = entry["name_en"]
    role = entry["role"]
    char_id = cid(name_en)
    trait = trait_id(name_en)
    skill = int(entry.get("skill", 3))
    role_traits = entry.get("traits", {})
    leader_type = role_traits.get("trait_type", "")
    portrait_large = f"GFX_Portrait_{char_id}"
    portrait_small = f"GFX_Idea_{char_id}"

    lines = []
    lines.append(f"\t{char_id} = {{")
    lines.append(f"\t\tname = {char_id}")
    lines.append(f"\t\tportraits = {{")
    if role == "army_leader":
        lines.append(f"\t\t\tarmy = {{")
    elif role == "navy_leader":
        lines.append(f"\t\t\tnavy = {{")
    else:
        lines.append(f"\t\t\tcivilian = {{")
    lines.append(f"\t\t\t\tlarge = {portrait_large}")
    lines.append(f"\t\t\t\tsmall = {portrait_small}")
    lines.append(f"\t\t\t}}")
    lines.append(f"\t\t}}")

    if role == "country_leader":
        lines.append(f"\t\tcountry_leader = {{")
        lines.append(f"\t\t\tideology = neutrality")
        lines.append(f"\t\t\ttraits = {{ {trait} }}")
        lines.append(f"\t\t\texpire = \"1965.1.1.1\"")
        lines.append(f"\t\t\tid = -1")
        lines.append(f"\t\t}}")
    elif role == "political_advisor":
        lines.append(f"\t\tadvisor = {{")
        lines.append(f"\t\t\tslot = political_advisor")
        lines.append(f"\t\t\tidea_token = {char_id}")
        lines.append(f"\t\t\ttraits = {{ {trait} }}")
        lines.append(f"\t\t\tallowed = {{ original_tag = CHI }}")
        lines.append(f"\t\t\tcost = 100")
        lines.append(f"\t\t}}")
    elif role == "theorist":
        lines.append(f"\t\tadvisor = {{")
        lines.append(f"\t\t\tslot = theorist")
        lines.append(f"\t\t\tidea_token = {char_id}")
        lines.append(f"\t\t\ttraits = {{ {trait} }}")
        lines.append(f"\t\t\tallowed = {{ original_tag = CHI }}")
        lines.append(f"\t\t\tcost = 100")
        lines.append(f"\t\t}}")
    elif role == "army_chief":
        lines.append(f"\t\tadvisor = {{")
        lines.append(f"\t\t\tslot = chief_of_army")
        lines.append(f"\t\t\tidea_token = {char_id}")
        lines.append(f"\t\t\ttraits = {{ {trait} }}")
        lines.append(f"\t\t\tallowed = {{ original_tag = CHI }}")
        lines.append(f"\t\t\tcost = 100")
        lines.append(f"\t\t}}")
    elif role == "navy_chief":
        lines.append(f"\t\tadvisor = {{")
        lines.append(f"\t\t\tslot = chief_of_navy")
        lines.append(f"\t\t\tidea_token = {char_id}")
        lines.append(f"\t\t\ttraits = {{ {trait} }}")
        lines.append(f"\t\t\tallowed = {{ original_tag = CHI }}")
        lines.append(f"\t\t\tcost = 100")
        lines.append(f"\t\t}}")
    elif role == "air_chief":
        lines.append(f"\t\tadvisor = {{")
        lines.append(f"\t\t\tslot = chief_of_air")
        lines.append(f"\t\t\tidea_token = {char_id}")
        lines.append(f"\t\t\ttraits = {{ {trait} }}")
        lines.append(f"\t\t\tallowed = {{ original_tag = CHI }}")
        lines.append(f"\t\t\tcost = 100")
        lines.append(f"\t\t}}")
    elif role == "high_command":
        lines.append(f"\t\tadvisor = {{")
        lines.append(f"\t\t\tslot = high_command")
        lines.append(f"\t\t\tidea_token = {char_id}")
        lines.append(f"\t\t\ttraits = {{ {trait} }}")
        lines.append(f"\t\t\tallowed = {{ original_tag = CHI }}")
        lines.append(f"\t\t\tcost = 100")
        lines.append(f"\t\t}}")
    elif role == "army_leader":
        block = "field_marshal" if leader_type == "field_marshal" else "corps_commander"
        lines.append(f"\t\t{block} = {{")
        lines.append(f"\t\t\ttraits = {{ {trait} }}")
        lines.append(f"\t\t\tskill = {skill}")
        lines.append(f"\t\t\tattack_skill = {skill}")
        lines.append(f"\t\t\tdefense_skill = {skill}")
        lines.append(f"\t\t\tplanning_skill = {skill}")
        lines.append(f"\t\t\tlogistics_skill = {skill}")
        lines.append(f"\t\t\tlegacy_id = -1")
        lines.append(f"\t\t}}")
    elif role == "navy_leader":
        lines.append(f"\t\tnavy_leader = {{")
        lines.append(f"\t\t\ttraits = {{ {trait} }}")
        lines.append(f"\t\t\tskill = {skill}")
        lines.append(f"\t\t\tattack_skill = {skill}")
        lines.append(f"\t\t\tdefense_skill = {skill}")
        lines.append(f"\t\t\tmaneuvering_skill = {skill}")
        lines.append(f"\t\t\tcoordination_skill = {skill}")
        lines.append(f"\t\t}}")

    lines.append(f"\t}}")
    return "\n".join(lines)


def write_country_trait_block(entry):
    name_en = entry["name_en"]
    role = entry["role"]
    if role in {"army_leader", "navy_leader"}:
        return None
    trait = trait_id(name_en)
    trait_values = entry.get("traits", {})
    lines = [f"\t{trait} = {{", f"\t\trandom = no"]
    for k, v in trait_values.items():
        if k == "trait_type":
            continue
        lines.append(f"\t\t{k} = {fmt_value(v)}")
    lines.append("\t}")
    return "\n".join(lines)


def write_unit_trait_block(entry):
    name_en = entry["name_en"]
    role = entry["role"]
    if role not in {"army_leader", "navy_leader"}:
        return None
    trait = trait_id(name_en)
    trait_values = entry.get("traits", {})
    lines = [f"\t{trait} = {{", f"\t\trandom = no"]
    for k, v in trait_values.items():
        if k == "trait_type":
            continue
        lines.append(f"\t\t{k} = {fmt_value(v)}")
    lines.append("\t}")
    return "\n".join(lines)


def write_gfx_blocks(entry):
    name_en = entry["name_en"]
    char_id = cid(name_en)
    lines = []
    lines.append("\tspriteType = {")
    lines.append(f"\t\tname = \"GFX_Portrait_{char_id}\"")
    lines.append(f"\t\ttexturefile = \"gfx/leaders/CHI/Portrait_{char_id}.dds\"")
    lines.append("\t\tlegacy_lazy_load = no")
    lines.append("\t}")
    lines.append("\tspriteType = {")
    lines.append(f"\t\tname = \"GFX_Idea_{char_id}\"")
    lines.append(f"\t\ttexturefile = \"gfx/interface/ideas/Idea_{char_id}.dds\"")
    lines.append("\t\tlegacy_lazy_load = no")
    lines.append("\t}")
    return "\n".join(lines)


def main():
    data = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    li_linfu = {
        "name_cn": "李林甫",
        "name_en": "Li_Linfu",
        "role": "political_advisor",
        "traits": {
            "political_power_gain": 0.20,
            "stability_weekly": 0.002,
            "subversive_activites_upkeep": -0.2,
            "enemy_operative_detection_chance_factor": 0.1
        },
        "desc": ""
    }
    data_all = [li_linfu] + data

    char_blocks = [write_character_block(e) for e in data_all]
    CHAR_PATH.write_text("characters = {\n\n" + "\n\n".join(char_blocks) + "\n}\n", encoding="utf-8")

    country_trait_blocks = [write_country_trait_block(e) for e in data_all]
    country_trait_blocks = [b for b in country_trait_blocks if b]
    COUNTRY_TRAIT_PATH.write_text("leader_traits = {\n\n" + "\n\n".join(country_trait_blocks) + "\n}\n", encoding="utf-8")

    unit_trait_blocks = [write_unit_trait_block(e) for e in data_all]
    unit_trait_blocks = [b for b in unit_trait_blocks if b]
    UNIT_TRAIT_PATH.write_text("leader_traits = {\n\n" + "\n\n".join(unit_trait_blocks) + "\n}\n", encoding="utf-8")

    gfx_blocks = [write_gfx_blocks(e) for e in data_all]
    GFX_PATH.write_text("spriteTypes = {\n" + "\n\n".join(gfx_blocks) + "\n}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
