import type { FieldDef } from '../data/types.ts'

/** 约束图标：12×12 线稿，stroke 继承 currentColor（裁决 2026-10-10：行宽不够，全部用图标表示） */

function Icon({ name, title }: { name: string; title: string }): React.ReactElement {
  return (
    <svg
      className={`constraint-icon constraint-${name}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
    >
      <title>{title}</title>
      {iconPaths(name)}
    </svg>
  )
}

function iconPaths(name: string): React.ReactNode {
  switch (name) {
    case 'pk': // 钥匙：左下圆环 + 右上斜杆 + 齿
      return (
        <>
          <circle cx="3.6" cy="8.4" r="2.2" />
          <path d="M 5.2 6.8 L 10.2 1.8" />
          <path d="M 7.6 4.4 L 9.4 6.2" />
        </>
      )
    case 'index': // 排序条：三横线（末线半长）
      return (
        <>
          <path d="M 1.5 3 H 10.5" />
          <path d="M 1.5 6 H 10.5" />
          <path d="M 1.5 9 H 6.5" />
        </>
      )
    case 'unique': // 雪花：三线过中心成 * 形
      return (
        <>
          <path d="M 6 1 V 11" />
          <path d="M 1.7 3.5 L 10.3 8.5" />
          <path d="M 10.3 3.5 L 1.7 8.5" />
        </>
      )
    case 'nullable': // 空集 ∅：圆 + 45° 斜杠
      return (
        <>
          <circle cx="6" cy="6" r="4" />
          <path d="M 3 9 L 9 3" />
        </>
      )
    case 'default': // 魔棒：斜杆 + 头部两星点
      return (
        <>
          <path d="M 3 9.5 L 7.5 5" />
          <path d="M 8.5 1.5 V 4.5" />
          <path d="M 7 3 H 10" />
          <path d="M 10 7.5 V 9.5" />
          <path d="M 9 8.5 H 11" />
        </>
      )
    case 'group': // 文件夹：tab + 盒身
      return <path d="M 1.5 2.5 H 4.5 L 6 4 H 10.5 V 9.5 H 1.5 Z" />
    default:
      return null
  }
}

/** 字段行右侧约束图标序列：pk → index → unique → nullable → default → group */
export function ConstraintIcons({ field }: { field: FieldDef }): React.ReactNode {
  const icons: React.ReactNode[] = []
  if (field.pk) icons.push(<Icon key="pk" name="pk" title="主键" />)
  if (field.index) icons.push(<Icon key="index" name="index" title="索引" />)
  if (field.unique) icons.push(<Icon key="unique" name="unique" title="唯一" />)
  if (field.nullable) icons.push(<Icon key="nullable" name="nullable" title="可空" />)
  if (field.default !== undefined)
    icons.push(<Icon key="default" name="default" title={`默认值 = ${JSON.stringify(field.default)}`} />)
  if (field.group) icons.push(<Icon key="group" name="group" title="分组" />)
  return <span className="er-row-badges">{icons}</span>
}
