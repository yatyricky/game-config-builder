# 概述

这是一个游戏配置编辑器。底层数据逻辑：关系型数据库，source of truth: json格式的数据。编辑器：极其克制的电子表格，并非另一个excel online。架构：纯静态网站，浏览器通过File System Access API获取本地文件夹权限后进行I/O。npm, ts.

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

#### 类型定义修订（2026-10-09 裁决：ADT 代数数据类型）

- 字段的 `type` 为递归节点：`{ "raw": "标量或类型名" }` | `{ "array": true, "elementType": <节点> }` | `{ "map": true, "keyType": <节点>, "valueType": <节点> }`，可无限嵌套（如 `map<string, array<map<string, array<number>>>>`）
- raw 可引用标量（string/number/boolean）或任意命名类型；直接 struct 引用与递归引用（如树节点 `array<自身>`）合法，数据合法性由 JSON 本身承载
- 旧的扁平写法（map/keyType/valueType/array/element 直接拍在字段上）已废弃，仅认 ADT 形态

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
        { "name": "ID", "type": { "raw": "string" }, "pk": true }, # pk 字段必须为string
        { "name": "Name", "type": { "raw": "string" } },
        { "name": "FuncName", "type": { "raw": "string" } }
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
        { "name": "ID", "type": { "raw": "string" }, "pk": true },
        { "name": "Name", "type": { "raw": "string" } },
        { "name": "School", "type": { "raw": "School" } },
        { "name": "Effects", "type": { "map": true, "keyType": { "raw": "Effect" }, "valueType": { "raw": "number" } } },
        { "name": "LevelRequirements", "displayName": "LvlReq", "type": { "array": true, "elementType": { "raw": "number" } } }
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

- 自研虚拟表格
- 必须指定一个schema类型，比如`Skill`
- 表头为`Skill`的`displayName` || `name`
- 行头为行号，纯展示用，与数据无关
- 冻结表头与行头
- 用户可以选择冻结前若干列

### 空表渲染样例和行为如下

||ID|Name|School|Effects|LvlReq|
|---|---|---|---|---|---|
|1||||||
|2||||||
|3||||||

#### 基本描述

- 表格第一列的自然数为行控件（行头），不可编辑
- 表格第一行为schema定义的fields（表头），不可直接编辑
- `表格工作区`被定义为除开表头、行头的其他单元格，简称`工作区`
- 工作区cols为字段个数
- 工作区rows为记录个数+10
- 鼠标在单元格上变为excel那个粗体空心十字右下方硬阴影的指针
- 鼠标在表头上变为excel的⇩箭头
- 鼠标在行头上变为excel的⇨箭头

#### 选中与导航（单选）

- 默认选中表格工作区第一行第一列的格子，在上面样例中，就是 `ID-1` 这个单元格（实际上就是整张表的第二行第二列，后面不再赘述）
- 点击cell可以选中一个单元格
- 选中的单元格为`焦点`
- 选中的单元格粗框显示
- 按上下左右方向键可以移动所选单元格
  - 所选单元格到第一列以后，按左箭头不生效
  - 所选单元格到第一行以后，按上箭头不生效
  - 所选单元格到最后一行以后，按下箭头不生效
  - 所选单元格到最后一列以后，按右箭头不生效
- 单选导航状态下
  - 回车键等效下箭头
  - shift+回车等效上箭头
  - tab键等效右箭头
  - shift+tab等效左箭头
- 选择不许超越工作区

#### 选中与导航（多选）

- 点击cell然后拖拽可以选中多个单元格
- 点击表头可以选中整列，点击表头然后拖拽可以选中多列（本质上是选中这些列的所有单元格）
- 点击行头可以选中整行，点击行头然后拖拽可以选中多行（本质上是选中这些行的所有单元格）
- 多个单元格形成一个`矩阵`
- 焦点默认为矩阵第一行第一列的单元格
- 除焦点外，多选的单元格背景被阴影覆盖
- 多选状态下
  - 上下左右箭头立即退出多选模式，将焦点视同所选单元格，然后执行单选导航的逻辑
  - 回车键将焦点在矩阵内的row坐标+1，如果新row超出矩阵范围，则回到矩阵第一行，并且将col坐标+1，如果新col超出矩阵范围，则回到矩阵第一列
  - shift+回车键将焦点在矩阵内的row坐标-1，如果新row超出矩阵范围，则回到矩阵最后一行，并且将col坐标-1，如果新col超出矩阵范围，则回到矩阵最后一列
  - tab键将焦点在矩阵内的col坐标+1，如果新col超出矩阵范围，则回到矩阵第一列，并且将row坐标+1，如果新row超出矩阵范围，则回到矩阵第一行
  - shift+tab键将焦点在矩阵内的col坐标-1，如果新col超出矩阵范围，则回到矩阵最后一列，并且将row坐标-1，如果新row超出矩阵范围，则回到矩阵最后一行

#### shift+方向键调整矩阵

- 选中矩阵后（1x1 也算），shift+方向键调整矩阵边界
- 收缩 ⟺ 焦点在箭头方向上的最远端且矩阵在该方向 ≥2，此时取消对侧一列/行；否则沿箭头方向扩展一列/行
- 扩展/收缩后焦点原地不动（用户裁决 2026-10-08）
- 扩展不得超越工作区（越界时该次扩展无效）；收缩因要求该方向 ≥2 永不使矩阵塌缩

#### 编辑

- 导航状态与编辑状态的控件不同
- 单元格根据字段类型使用不同控件，比如string类型的导航状态就是一个最基础的div，编辑状态则是一个text input，其他类型先 NotImplemented。
- 双击单元格，或者选中状态按F2，单元格进入编辑状态，控件切换为编辑态控件
  - 很显然，双击会丢失多选，双击的第一次点击即导致多选的丢失，变为选中目标单元格成为焦点，双击的第二次点击等价于编辑焦点
  - 单选或者多选状态下按F2，只是编辑焦点
- 编辑状态，方向键只操作编辑控件，比如input中，左右键是移动caret一个字符，上下键是将caret移动到文本首或者文本尾。
- 编辑状态，回车、shift+回车、tab、shift+tab 一般为提交内容，切换为导航态，然后执行该按键导航态的行为。除非编辑状态的控件另有拦截。
- 导航状态，string类型的焦点，可以直接通过IME进入编辑态并且不消费本次键盘事件。

- 选中单元格之后，ctrl+c复制所有单元格引用到剪切板
- 另选中单元格，ctrl+v可以将引用的内容复制到当前单元格，不同类型的单元格提供隐式转换函数，未提供者报错并复制失败。例如

```js
function copyPasteNumber2String(value) {
    return String(value)
}

function copyPasteString2Number(value) {
    // parse value to number
    // throw when empty, isNaN, or infinity, etc.
}

// 定义转换表
defineImplicitConversion("number", "string", copyPasteNumber2String)
// 未定义string转number

// 此时，如果用户将number cell复制到string cell，程序会通过copyPasteNumber2String进行转换
// 如果用户将string cell复制到number cell，程序会报错并阻断这次操作
```

- 如果目标选区的cols和rows均大于等于剪切板，则以不超过选区tiling的方式填充

```
比如复制了一个cell的"my text"，选取一列之后按 ctrl+v，那么整列都会被设置为"my text"。（假设类型匹配）
```

```
又比如复制了
ab
cd

目标选区为
oooooo
oooooo
oooooo

那么结果为
ababac
cdcdcd
oooooo
```

#### 编辑交互增补（2026-10-08 裁决）

- schema 字段可带可选 `default` 属性：无 `default` 的字段为必填（required）
- 空行（底部预留行）可直接编辑；一行记录的成立条件是所有必填字段全部配置
- 空记录保存时自动删掉，前端立即响应（中间空行全部被删）；记录存在必填字段为空时无法保存；强行刷新、关闭页面会导致数据丢失（如可以，弹窗警告）【以上保存侧规则自 M7 生效】
- Esc 取消编辑，恢复原值回导航态
- 编辑中点击其他单元格：先提交再执行选中；若输入非法导致无法提交，忽略该次点击并提示修正后提交

#### 复制粘贴增补（2026-10-08 裁决）

- 复制后源选区显示虚线跑马灯线框（焦点黑框改虚线样式套在复制区上，行进蚂蚁动画）
- 进入编辑模式前清除剪切板（线框随之消失）
- 粘贴目标选区不允许与复制源有交集：有交集时报错并阻断

#### 类型编辑（2026-10-10 裁决，M8b-1）

- 卡片标题栏与字段行同排布（名称+kind 左对齐）；右侧从右至左：垃圾桶（无引用且无数据时出现）、加号（新增字段/成员）、写字图标（enum 卡片编辑：名称无引用可改；flags 被使用且值非 2^n 序列时不可勾选，否则自由切换）
- 新建类型（画布标题栏按钮）：名称 + struct/enum 下拉（默认 struct）+ enum→flags checkbox；空/重复/与 js 基础类型冲突 → 红框无法保存；确认后二次确认弹窗（名称难改）；struct 自动带 ID（pk、raw:string）
- 字段编辑弹窗：名称（非空 trim、卡内重名红框、不得与数据键冲突）；displayName（任意类型可选，仅显示在表头）；default 仅基础类型（string 空=空串永 trim / number 必填 / boolean 下拉默认 false；array/map 隐式 []/{} 不物化）；类型树=递归级联下拉（命名可选集=enum+有 pk 的 struct+自身），字段已被数据使用→整树只读
- 约束链：pk（已有其他 pk / 非 raw:string / 被引用或存在同名表 → disabled）→ index 强制 → unique 强制；nullable 勾选允许不填（必填=无 default 且未 nullable）；group 纯元数据
- struct 无 pk → 卡片红边、解析器 issue、不可被引用、不可被表格使用
- 枚举成员：name/displayName/value 三重唯一（红框+解析器 issue）；新增值 flags 自动=前值×2（首=1）、非 flags 建议=前值+1（首=0）；flags 成员 ≥30 无法新增；成员值被表数据使用 → 删除禁用
- 删除规则：字段被数据使用不可删；类型删除=删 schema 文件（+struct 空表文件）
- 保存：字段/成员编辑显式写盘 schema/<Type>.json（改名级联数据键并连写数据文件）；新增字段/成员/类型均二次确认
- pk/unique 字段保存表数据时查重，重复阻止保存（G5 遗留落定）

### 带前面样例数据的渲染大致如下

||ID|Name|School|Effects|LvlReq|
|---|---|---|---|---|---|
|1|0001|Strike|(Earth)(Air)|[Strike:20]|1,3,6|
|2|0002|Meditation|(Water)|[Heal:30]...|1,4,15|
|3||||||
|4||||||
|5||||||

### schema编辑

待定

### 菜单

页面布局大致如下（##为注释，并非展示内容）

```
---------------------------------------------------------------------------------
GCB [C:\Users\billy\workspace\mir-remaster\config ▼] [打开] [保存] [导出] ## 使用足够宽度的下拉菜单展示完整路径，点击后可以显示近期打开的工程，保存在localstorage
---------------------------------------------------------------------------------
+--+------+------------+--------------+-------------+----------+
|  | ID ▼ | Name     ▼ | School     ▼ | Effects   ▼ | LvlReq ▼ |
+--+------+------------+--------------+-------------+----------+
| 1| 0001 | Strike     | (Earth)(Air) | [Strike:20] | 1,3,6    |
+--+------+------------+--------------+-------------+----------+
| 2| 0002 | Meditation | (Water)      | [Heal:30]...| 1,4,15   |
+--+------+------------+--------------+-------------+----------+
| 3|      |            |              |             |          |
+--+------+------------+--------------+-------------+----------+
| 4|      |            |              |             |          |
+--+------+------------+--------------+-------------+----------+
| 5|      |            |              |             |          |
+--+------+------------+--------------+-------------+----------+
---------------------------------------------------------------------------------
Schemas | School | Effect | Skill | [+新建表格] ## 一行tab标签页，新建表格按钮被挤到最右端之后冻结显示，其他页签形成一个横向scroll view，滚动条就4个像素高
---------------------------------------------------------------------------------

```

表头有小箭头，点击后承担排序筛选等功能，后面再说。

#### 菜单修订（2026-10-09 裁决）

- 底栏页签区 = 各表页签 + `+`（新建表格入口，仅显示加号），两者共享同一横向 scrollview——`+` 随内容滚动，不再冻结最右
- Schemas 不再作为底栏页签，入口移至顶栏按钮，快捷键 Ctrl+,（配置的意味）
- Ctrl+1..9 = 打开第 n 张工作表（Schemas 不占序号）
- 技术事实：FSA 安全模型不暴露完整路径，顶栏下拉只能显示目录名
- 设置（Schemas 入口）不占工作表：以几乎占满工作表区的 modal 弹出，保证工作表逻辑一致性；schema 以 ER 式卡片节点图呈现——一类型一卡片，字段引用连线到目标 struct 的 pk 行（enum 不连线；仅简单连线，无箭头/连线类型）；卡片可拖拽，位置与缩放按工程目录名持久化（同名目录共享），分层自动布局作缺省，「重置布局」可复原（2026-10-10 裁决）

## 后端（File System Access API）

用户的编辑都会自动保存，然后经由API写盘。
