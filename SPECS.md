# 概述

这是一个游戏配置编辑器。底层数据逻辑：关系型数据库，source of truth: json格式的数据。编辑器：极其克制的电子表格，并非另一个excel online。架构：纯静态网站，浏览器通过File System Access API获取本地文件夹权限后进行I/O。pnpm, ts.

## 数据

一个目录为一个配置工程，layout如下：

```
MyProject/
    schema/
        <TypeName1>.json # 配置描述文件，定义了数据类型
        <TypeName2>.json # ...
    export/
        <FileName>.<ext> # 导出的数据
    <SheetName1>.json # 指定一种TypeName的表格
    <SheetName2>.json # ...
```

所有schema合并处理，分离是为了版本管理和易读性，可以定义数据类型，典型的schema类似这样：
> 自定义类型的名称必须不能与js基础类型冲突

```json schema/School.json
{
    "meta": {
        "type": "enum",
        "name": "School",
        "flags": true
    },
    "enums": [
        { "name": "Fire", "value": 1 },
        { "name": "Earth", "value": 2 },
        { "name": "Air", "value": 4 },
        { "name": "Water", "value": 8 }
    ]
}
```

```json schema/Effect.json
{
    "meta": {
        "type": "struct",
        "name": "Effect"
    },
    "fields": [
        { "name": "ID", "type": "string", "pk": true }, # pk 字段必须为string
        { "name": "Name", "type": "string" },
        { "name": "FuncName", "type": "string" }
    ]
}
```
 
```json schema/Skill.json
{
    "meta": {
        "type": "struct",
        "name": "Skill"
    },
    "fields": [
        { "name": "ID", "type": "string", "pk": true },
        { "name": "Name", "type": "string" },
        { "name": "School", "type": "School" },
        { "name": "Effects", "map": true, "keyType": "Effect", "valueType": "number" },
        { "name": "LevelRequirements", "displayName": "LvlReq", "array": true, "elementType": "number" },
    ]
}
```

表格数据类似这样：

```jsonl Effect.json
{"ID": "001", "Name": "Damage", "FuncName": "EffectDamage"}
{"ID": "002", "Name": "Heal", "FuncName": "EffectHeal"}
{"ID": "003", "Name": "Stun", "FuncName": "EffectStun"}
```

```jsonl Skill.json
{"ID": "0001", "Name": "Strike", "School": 6, "Effects": {"001": 20}, "LevelRequirements": [1, 3, 6]}
{"ID": "0002", "Name": "Meditation", "School": 8, "Effects": {"002": 30, "003": 2}, "LevelRequirements": [1, 4, 15]}
```

## 前端

- 虚拟表格
- 必须指定一个schema类型，比如`Skill`
- 表头为`Skill`的`displayName` || `name`
- 默认选中
- 点击cell选中，双击/F2进入编辑
- 点击cell然后拖选：选中多个单元格
- 选中单元格后：ctrl+c复制所选内容到剪切板
- 
