/* @ds-bundle: {"format":4,"namespace":"MaelleDesignSystem_b45620","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"Provenance","sourcePath":"components/brand/Provenance.jsx"},{"name":"Wordmark","sourcePath":"components/brand/Wordmark.jsx"},{"name":"KeyValueList","sourcePath":"components/data/KeyValueList.jsx"},{"name":"TicketRow","sourcePath":"components/data/TicketRow.jsx"},{"name":"StatusPill","sourcePath":"components/feedback/StatusPill.jsx"},{"name":"Panel","sourcePath":"components/surfaces/Panel.jsx"},{"name":"PanelHeader","sourcePath":"components/surfaces/PanelHeader.jsx"},{"name":"Eyebrow","sourcePath":"components/type/Eyebrow.jsx"},{"name":"Mono","sourcePath":"components/type/Mono.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"b7b99f632d08","components/brand/Provenance.jsx":"00fcf5dd2e34","components/brand/Wordmark.jsx":"174e735aac8a","components/data/KeyValueList.jsx":"79b16c992d99","components/data/TicketRow.jsx":"eb7de12dfea3","components/feedback/StatusPill.jsx":"94349a324a87","components/surfaces/Panel.jsx":"4112b4bfa36d","components/surfaces/PanelHeader.jsx":"161504ebde3c","components/type/Eyebrow.jsx":"e2a822849855","components/type/Mono.jsx":"65db13ea032a","ui_kits/approvals/App.jsx":"97f91a110962","ui_kits/approvals/DecisionCard.jsx":"729f5a4ebe09","ui_kits/approvals/DraftReply.jsx":"917b624c0407","ui_kits/approvals/IncomingList.jsx":"ee0ee85cbc7d","ui_kits/approvals/Topbar.jsx":"3a616d5ef4b0","ui_kits/approvals/data.js":"40c9b45b36d9"},"inlinedExternals":[],"unexposedExports":[]} */

;(() => {
  const __ds_ns = (window.MaelleDesignSystem_b45620 = window.MaelleDesignSystem_b45620 || {})

  const __ds_scope = {}

  __ds_ns.__errors = __ds_ns.__errors || []

  // components/actions/Button.jsx
  try {
    ;(() => {
      function _extends() {
        return (
          (_extends = Object.assign
            ? Object.assign.bind()
            : function (n) {
                for (var e = 1; e < arguments.length; e++) {
                  var t = arguments[e]
                  for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r])
                }
                return n
              }),
          _extends.apply(null, arguments)
        )
      }
      function Button({
        variant = 'primary',
        size = 'md',
        disabled = false,
        children,
        style,
        onClick,
        ...rest
      }) {
        const [hover, setHover] = React.useState(false)
        const pad =
          size === 'sm'
            ? '7px 14px'
            : variant === 'primary'
              ? 'var(--pad-button)'
              : 'var(--pad-button-secondary)'
        const base = {
          fontFamily: 'var(--font-sans)',
          fontSize: size === 'sm' ? 13 : 14,
          fontWeight: 600,
          borderRadius: 'var(--radius-md)',
          padding: pad,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          transition:
            'filter var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          lineHeight: 1.2,
        }
        const v = {
          primary: {
            color: 'var(--action-primary-fg)',
            background: 'var(--action-primary-bg)',
            border: '1px solid var(--action-primary-bg)',
            filter: hover && !disabled ? 'var(--hover-brighten)' : 'none',
          },
          secondary: {
            color: 'var(--text-primary)',
            background: 'transparent',
            border:
              '1px solid ' +
              (hover && !disabled
                ? 'var(--action-secondary-border-hover)'
                : 'var(--action-secondary-border)'),
          },
          ghost: {
            color: hover && !disabled ? 'var(--text-primary)' : 'var(--text-secondary)',
            background: 'transparent',
            border: '1px solid transparent',
          },
        }[variant]
        return /*#__PURE__*/ React.createElement(
          'button',
          _extends(
            {
              disabled: disabled,
              onClick: onClick,
              onMouseEnter: () => setHover(true),
              onMouseLeave: () => setHover(false),
              style: {
                ...base,
                ...v,
                ...style,
              },
            },
            rest,
          ),
          children,
        )
      }
      Object.assign(__ds_scope, { Button })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/actions/Button.jsx',
      error: String((e && e.message) || e),
    })
  }

  // components/brand/Provenance.jsx
  try {
    ;(() => {
      function Provenance({ children, style }) {
        return /*#__PURE__*/ React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              ...style,
            },
          },
          /*#__PURE__*/ React.createElement('span', {
            style: {
              width: 8,
              height: 8,
              flex: 'none',
              background: 'var(--brand-accent)',
              transform: 'rotate(45deg)',
            },
          }),
          /*#__PURE__*/ React.createElement(
            'span',
            {
              style: {
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                color: 'var(--text-secondary)',
              },
            },
            children,
          ),
        )
      }
      Object.assign(__ds_scope, { Provenance })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/brand/Provenance.jsx',
      error: String((e && e.message) || e),
    })
  }

  // components/brand/Wordmark.jsx
  try {
    ;(() => {
      function Wordmark({ size = 104, tagline = false, monogram = false, style }) {
        const mark = /*#__PURE__*/ React.createElement(
          'span',
          {
            style: {
              fontFamily: 'var(--font-serif-display)',
              fontWeight: 400,
              fontSize: size,
              lineHeight: 0.9,
              letterSpacing: '-0.01em',
              color: 'var(--text-primary)',
            },
          },
          monogram ? 'M' : 'Maell',
          /*#__PURE__*/ React.createElement(
            'span',
            {
              style: {
                color: 'var(--brand-accent)',
              },
            },
            'e',
          ),
        )
        if (!tagline)
          return /*#__PURE__*/ React.createElement(
            'span',
            {
              style: style,
            },
            mark,
          )
        return /*#__PURE__*/ React.createElement(
          'span',
          {
            style: {
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 10,
              ...style,
            },
          },
          mark,
          /*#__PURE__*/ React.createElement(
            'span',
            {
              style: {
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
              },
            },
            'The leader that serves',
          ),
        )
      }
      Object.assign(__ds_scope, { Wordmark })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/brand/Wordmark.jsx',
      error: String((e && e.message) || e),
    })
  }

  // components/data/KeyValueList.jsx
  try {
    ;(() => {
      function KeyValueList({ items = [], style }) {
        return /*#__PURE__*/ React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 'var(--pad-inset)',
              background: 'var(--surface-inset)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-default)',
              ...style,
            },
          },
          items.map((it, i) =>
            /*#__PURE__*/ React.createElement(
              'div',
              {
                key: i,
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                },
              },
              /*#__PURE__*/ React.createElement(
                'span',
                {
                  style: {
                    color: 'var(--text-secondary)',
                  },
                },
                it.label,
              ),
              /*#__PURE__*/ React.createElement(
                'span',
                {
                  style: {
                    color: 'var(--text-primary)',
                    fontFamily: it.mono ? 'var(--font-mono)' : 'var(--font-sans)',
                  },
                },
                it.value,
              ),
            ),
          ),
        )
      }
      Object.assign(__ds_scope, { KeyValueList })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/data/KeyValueList.jsx',
      error: String((e && e.message) || e),
    })
  }

  // components/feedback/StatusPill.jsx
  try {
    ;(() => {
      const COLORS = {
        draft: '#C6A15B',
        warning: '#E58C4F',
        info: '#88A9CF',
        success: '#8DBA84',
        error: '#E26A60',
      }
      const LABELS = {
        draft: 'Draft ready',
        warning: 'Needs review',
        info: 'In progress',
        success: 'Resolved',
        error: 'Escalated',
      }
      function StatusPill({ status = 'draft', children, style }) {
        const c = COLORS[status] || COLORS.draft
        return /*#__PURE__*/ React.createElement(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: 'var(--pad-pill)',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid ' + c + '55',
              background: c + '14',
              color: c,
              fontFamily: 'var(--font-sans)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              ...style,
            },
          },
          /*#__PURE__*/ React.createElement('span', {
            style: {
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: c,
            },
          }),
          children ?? LABELS[status],
        )
      }
      Object.assign(__ds_scope, { StatusPill })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/feedback/StatusPill.jsx',
      error: String((e && e.message) || e),
    })
  }

  // components/data/TicketRow.jsx
  try {
    ;(() => {
      function TicketRow({
        id,
        title,
        meta,
        status = 'draft',
        statusLabel,
        selected = false,
        first = false,
        onClick,
        style,
      }) {
        const [hover, setHover] = React.useState(false)
        return /*#__PURE__*/ React.createElement(
          'div',
          {
            onClick: onClick,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            style: {
              display: 'grid',
              gridTemplateColumns: '54px minmax(0,1fr) auto',
              gap: 14,
              alignItems: 'center',
              padding: 'var(--pad-row)',
              borderTop: first ? 'none' : '1px solid var(--border-default)',
              background: selected
                ? 'var(--surface-elevated)'
                : hover && onClick
                  ? 'rgba(44,33,23,0.5)'
                  : 'transparent',
              cursor: onClick ? 'pointer' : 'default',
              ...style,
            },
          },
          /*#__PURE__*/ React.createElement(
            'span',
            {
              style: {
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-secondary)',
              },
            },
            id,
          ),
          /*#__PURE__*/ React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
              },
            },
            /*#__PURE__*/ React.createElement(
              'span',
              {
                style: {
                  fontFamily: 'var(--font-sans)',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                },
              },
              title,
            ),
            /*#__PURE__*/ React.createElement(
              'span',
              {
                style: {
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                },
              },
              meta,
            ),
          ),
          /*#__PURE__*/ React.createElement(
            __ds_scope.StatusPill,
            {
              status: status,
            },
            statusLabel,
          ),
        )
      }
      Object.assign(__ds_scope, { TicketRow })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/data/TicketRow.jsx',
      error: String((e && e.message) || e),
    })
  }

  // components/surfaces/Panel.jsx
  try {
    ;(() => {
      function Panel({ elevation = 'base', padding, children, style }) {
        const s = {
          background: elevation === 'base' ? 'var(--surface-base)' : 'var(--surface-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }
        if (elevation === 'focus') s.boxShadow = 'var(--shadow-lamp)'
        if (padding !== undefined) s.padding = padding
        return /*#__PURE__*/ React.createElement(
          'div',
          {
            style: {
              ...s,
              ...style,
            },
          },
          children,
        )
      }
      Object.assign(__ds_scope, { Panel })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/surfaces/Panel.jsx',
      error: String((e && e.message) || e),
    })
  }

  // components/surfaces/PanelHeader.jsx
  try {
    ;(() => {
      function PanelHeader({ title, meta, eyebrow = false, children, style }) {
        return /*#__PURE__*/ React.createElement(
          'div',
          {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              padding: 'var(--pad-panel-head)',
              borderBottom: '1px solid var(--border-default)',
              ...style,
            },
          },
          eyebrow
            ? /*#__PURE__*/ React.createElement(
                'span',
                {
                  style: {
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                  },
                },
                title,
              )
            : /*#__PURE__*/ React.createElement(
                'span',
                {
                  style: {
                    fontFamily: 'var(--font-serif-display)',
                    fontSize: 20,
                    color: 'var(--text-primary)',
                  },
                },
                title,
              ),
          meta != null &&
            /*#__PURE__*/ React.createElement(
              'span',
              {
                style: {
                  fontFamily: 'var(--font-mono)',
                  fontSize: eyebrow ? 11 : 12,
                  color: 'var(--text-secondary)',
                },
              },
              meta,
            ),
          children,
        )
      }
      Object.assign(__ds_scope, { PanelHeader })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/surfaces/PanelHeader.jsx',
      error: String((e && e.message) || e),
    })
  }

  // components/type/Eyebrow.jsx
  try {
    ;(() => {
      function Eyebrow({ children, tone = 'secondary', as: Tag = 'span', style }) {
        return /*#__PURE__*/ React.createElement(
          Tag,
          {
            style: {
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 'var(--ls-eyebrow)',
              textTransform: 'uppercase',
              color: tone === 'accent' ? 'var(--text-accent)' : 'var(--text-secondary)',
              margin: 0,
              ...style,
            },
          },
          children,
        )
      }
      Object.assign(__ds_scope, { Eyebrow })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/type/Eyebrow.jsx',
      error: String((e && e.message) || e),
    })
  }

  // components/type/Mono.jsx
  try {
    ;(() => {
      function Mono({ children, chip = false, size, style }) {
        const s = {
          fontFamily: 'var(--font-mono)',
          fontSize: size ?? (chip ? 13 : 12),
          color: chip ? 'var(--text-primary)' : 'var(--text-secondary)',
        }
        if (chip)
          Object.assign(s, {
            background: 'var(--surface-elevated)',
            padding: '1px 5px',
            borderRadius: 'var(--radius-xs)',
          })
        return /*#__PURE__*/ React.createElement(
          'span',
          {
            style: {
              ...s,
              ...style,
            },
          },
          children,
        )
      }
      Object.assign(__ds_scope, { Mono })
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'components/type/Mono.jsx',
      error: String((e && e.message) || e),
    })
  }

  // ui_kits/approvals/App.jsx
  try {
    ;(() => {
      function App() {
        const [tickets, setTickets] = React.useState(window.MAELLE_TICKETS)
        const [sel, setSel] = React.useState(localStorage.getItem('maelle-kit-sel') || '#4812')
        const [editing, setEditing] = React.useState(false)
        const [text, setText] = React.useState('')
        const t = tickets.find((x) => x.id === sel)
        const select = (id) => {
          setSel(id)
          setEditing(false)
          localStorage.setItem('maelle-kit-sel', id)
        }
        const toText = (b) => b.map((p) => p.replace(/[{}]/g, '')).join('\n\n')
        const onEdit = () => {
          if (editing) {
            setTickets((ts) =>
              ts.map((x) =>
                x.id === sel
                  ? {
                      ...x,
                      body: text.split(/\n\n+/),
                      version:
                        'v' + (parseInt((x.version.match(/v(\d)/) || [0, 1])[1]) + 1) + ' · edited',
                    }
                  : x,
              ),
            )
            setEditing(false)
          } else {
            setText(toText(t.body))
            setEditing(true)
          }
        }
        const onApprove = () => {
          setEditing(false)
          setTickets((ts) =>
            ts.map((x) =>
              x.id === sel
                ? {
                    ...x,
                    status: 'success',
                    statusLabel: 'Sent',
                    version: 'sent · now',
                  }
                : x,
            ),
          )
          const next = tickets.find(
            (x) => x.id !== sel && ['draft', 'warning', 'info'].includes(x.status),
          )
          if (next) setTimeout(() => select(next.id), 450)
        }
        const open = tickets.some((x) => ['draft', 'warning', 'info'].includes(x.status))
        return /*#__PURE__*/ React.createElement(
          'div',
          {
            style: {
              background: 'var(--surface-page)',
              minHeight: '100vh',
            },
          },
          /*#__PURE__*/ React.createElement(
            'div',
            {
              style: {
                maxWidth: 1180,
                margin: '0 auto',
              },
            },
            /*#__PURE__*/ React.createElement(Topbar, {
              open: open,
            }),
            /*#__PURE__*/ React.createElement(
              'div',
              {
                style: {
                  padding: '48px 64px 64px',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)',
                  gap: 28,
                  alignItems: 'start',
                },
              },
              /*#__PURE__*/ React.createElement(
                'div',
                {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 28,
                  },
                },
                /*#__PURE__*/ React.createElement(DecisionCard, {
                  t: t,
                  editing: editing,
                  onApprove: onApprove,
                  onEdit: onEdit,
                }),
                /*#__PURE__*/ React.createElement(IncomingList, {
                  tickets: tickets,
                  selected: sel,
                  onSelect: select,
                }),
              ),
              /*#__PURE__*/ React.createElement(DraftReply, {
                t: t,
                editing: editing,
                text: text,
                setText: setText,
              }),
            ),
          ),
        )
      }
      ReactDOM.createRoot(document.getElementById('root')).render(
        /*#__PURE__*/ React.createElement(App, null),
      )
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'ui_kits/approvals/App.jsx',
      error: String((e && e.message) || e),
    })
  }

  // ui_kits/approvals/DecisionCard.jsx
  try {
    ;(() => {
      function DecisionCard({ t, editing, onApprove, onEdit }) {
        const { Panel, Mono, StatusPill, KeyValueList, Button } = window.MaelleDesignSystem_b45620
        const actionable = t.status === 'draft' || t.status === 'warning' || t.status === 'info'
        return /*#__PURE__*/ React.createElement(
          Panel,
          {
            elevation: 'focus',
            padding: 28,
          },
          /*#__PURE__*/ React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
              },
            },
            /*#__PURE__*/ React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                },
              },
              /*#__PURE__*/ React.createElement(Mono, null, 'Ticket ', t.id, ' \xB7 ', t.title),
              /*#__PURE__*/ React.createElement(
                StatusPill,
                {
                  status: t.status,
                },
                t.statusLabel,
              ),
            ),
            /*#__PURE__*/ React.createElement(
              'p',
              {
                style: {
                  margin: 0,
                  fontFamily: 'var(--font-serif-display)',
                  fontSize: 26,
                  lineHeight: 1.2,
                  textWrap: 'pretty',
                },
              },
              t.decision,
            ),
            /*#__PURE__*/ React.createElement(KeyValueList, {
              items: t.summary,
            }),
            actionable &&
              /*#__PURE__*/ React.createElement(
                'div',
                {
                  style: {
                    display: 'flex',
                    gap: 10,
                  },
                },
                /*#__PURE__*/ React.createElement(
                  Button,
                  {
                    onClick: onApprove,
                  },
                  'Approve',
                ),
                /*#__PURE__*/ React.createElement(
                  Button,
                  {
                    variant: 'secondary',
                    onClick: onEdit,
                  },
                  editing ? 'Done editing' : 'Edit draft',
                ),
              ),
          ),
        )
      }
      window.DecisionCard = DecisionCard
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'ui_kits/approvals/DecisionCard.jsx',
      error: String((e && e.message) || e),
    })
  }

  // ui_kits/approvals/DraftReply.jsx
  try {
    ;(() => {
      function renderPara(p) {
        const { Mono } = window.MaelleDesignSystem_b45620
        const parts = p.split(/\{([^}]+)\}/)
        return parts.map((s, i) =>
          i % 2
            ? /*#__PURE__*/ React.createElement(
                Mono,
                {
                  key: i,
                  chip: true,
                },
                s,
              )
            : s.split('\n').map((l, j, a) =>
                /*#__PURE__*/ React.createElement(
                  React.Fragment,
                  {
                    key: i + '-' + j,
                  },
                  l,
                  j < a.length - 1 && /*#__PURE__*/ React.createElement('br', null),
                ),
              ),
        )
      }
      function DraftReply({ t, editing, text, setText }) {
        const { Panel, Eyebrow, Mono, Provenance } = window.MaelleDesignSystem_b45620
        return /*#__PURE__*/ React.createElement(
          Panel,
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
            },
          },
          /*#__PURE__*/ React.createElement(
            'div',
            {
              style: {
                padding: '18px 24px',
                borderBottom: '1px solid var(--border-default)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              },
            },
            /*#__PURE__*/ React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                },
              },
              /*#__PURE__*/ React.createElement(
                Eyebrow,
                null,
                editing ? 'Editing reply' : 'Drafted reply',
              ),
              /*#__PURE__*/ React.createElement(
                Mono,
                {
                  size: 11,
                },
                t.version,
              ),
            ),
            /*#__PURE__*/ React.createElement(
              'div',
              {
                style: {
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                },
              },
              'To ',
              /*#__PURE__*/ React.createElement(
                'span',
                {
                  style: {
                    color: 'var(--text-primary)',
                  },
                },
                t.email,
              ),
            ),
            /*#__PURE__*/ React.createElement(
              'div',
              {
                style: {
                  fontSize: 15,
                  fontWeight: 600,
                },
              },
              t.subject,
            ),
          ),
          editing
            ? /*#__PURE__*/ React.createElement('textarea', {
                value: text,
                onChange: (e) => setText(e.target.value),
                style: {
                  margin: 24,
                  minHeight: 260,
                  background: 'var(--surface-inset)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 6,
                  padding: 16,
                  color: 'var(--text-primary)',
                  font: '400 14px/1.6 var(--font-sans)',
                  resize: 'vertical',
                  outline: 'none',
                },
              })
            : /*#__PURE__*/ React.createElement(
                'div',
                {
                  style: {
                    padding: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    fontSize: 14,
                    lineHeight: 1.6,
                  },
                },
                t.body.map((p, i) =>
                  /*#__PURE__*/ React.createElement(
                    'p',
                    {
                      key: i,
                      style: {
                        margin: 0,
                        textWrap: 'pretty',
                      },
                    },
                    renderPara(p),
                  ),
                ),
              ),
          /*#__PURE__*/ React.createElement(
            'div',
            {
              style: {
                marginTop: 'auto',
                padding: '16px 24px',
                borderTop: '1px solid var(--border-default)',
              },
            },
            /*#__PURE__*/ React.createElement(
              Provenance,
              null,
              'Prepared by Maelle from ',
              t.sources,
            ),
          ),
        )
      }
      window.DraftReply = DraftReply
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'ui_kits/approvals/DraftReply.jsx',
      error: String((e && e.message) || e),
    })
  }

  // ui_kits/approvals/IncomingList.jsx
  try {
    ;(() => {
      function IncomingList({ tickets, selected, onSelect }) {
        const { Panel, PanelHeader, TicketRow } = window.MaelleDesignSystem_b45620
        const open = tickets.filter((t) => t.status !== 'success').length
        return /*#__PURE__*/ React.createElement(
          Panel,
          null,
          /*#__PURE__*/ React.createElement(PanelHeader, {
            title: 'Incoming',
            meta: open + ' open',
          }),
          tickets.map((t, i) =>
            /*#__PURE__*/ React.createElement(TicketRow, {
              key: t.id,
              first: i === 0,
              selected: t.id === selected,
              id: t.id,
              title: t.title,
              meta: t.who + ' · ' + t.ago,
              status: t.status,
              statusLabel: t.statusLabel,
              onClick: () => onSelect(t.id),
            }),
          ),
        )
      }
      window.IncomingList = IncomingList
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'ui_kits/approvals/IncomingList.jsx',
      error: String((e && e.message) || e),
    })
  }

  // ui_kits/approvals/Topbar.jsx
  try {
    ;(() => {
      function Topbar({ open }) {
        const { Wordmark, Mono, Eyebrow } = window.MaelleDesignSystem_b45620
        return /*#__PURE__*/ React.createElement(
          'div',
          {
            style: {
              padding: '48px 64px 40px',
              backgroundImage: 'var(--gradient-lamp)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: 40,
              borderBottom: '1px solid var(--border-default)',
            },
          },
          /*#__PURE__*/ React.createElement(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              },
            },
            /*#__PURE__*/ React.createElement(Eyebrow, null, 'Support \xB7 Billing'),
            /*#__PURE__*/ React.createElement(
              'h1',
              {
                style: {
                  margin: 0,
                  fontFamily: 'var(--font-serif-display)',
                  fontWeight: 400,
                  fontSize: 40,
                  lineHeight: 1.05,
                },
              },
              open ? 'Awaiting your decision' : 'Every draft, prepared',
            ),
          ),
          /*#__PURE__*/ React.createElement(Wordmark, {
            size: 56,
          }),
        )
      }
      window.Topbar = Topbar
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'ui_kits/approvals/Topbar.jsx',
      error: String((e && e.message) || e),
    })
  }

  // ui_kits/approvals/data.js
  try {
    ;(() => {
      window.MAELLE_TICKETS = [
        {
          id: '#4812',
          title: 'Refund request',
          who: 'Clara Novak',
          email: 'clara.novak@mail.com',
          ago: '2m ago',
          status: 'draft',
          decision: 'Refund $13.07 and cancel immediately',
          summary: [
            {
              label: 'Refund to Visa ··4417',
              value: '$13.07',
              mono: true,
            },
            {
              label: 'Cancel plan',
              value: 'Effective now',
            },
          ],
          subject: 'Re: Refund for my last charge',
          version: 'v2 · 14:02',
          sources: 'order history and billing log',
          body: [
            'Hi Clara,',
            'Thanks for getting in touch. I’ve refunded the charge of {$13.07} to your Visa ending in 4417, and your subscription is now cancelled with immediate effect.',
            'The refund usually appears within 5 to 10 business days. You’ll keep access to your saved files, and you can restart your plan at any time.',
            'Best regards,\nThe Support Team',
          ],
        },
        {
          id: '#4811',
          title: 'Cancel subscription',
          who: 'Tomás Ferreira',
          email: 'tomas.ferreira@mail.com',
          ago: '9m ago',
          status: 'warning',
          decision: 'Cancel at end of billing period',
          summary: [
            {
              label: 'Plan',
              value: 'Team · annual',
            },
            {
              label: 'Ends',
              value: '31 Oct 2026',
            },
          ],
          subject: 'Re: Cancel my subscription',
          version: 'v1 · 13:55',
          sources: 'account settings and plan history',
          body: [
            'Hi Tomás,',
            'I’ve scheduled your cancellation for the end of your current billing period on {31 Oct 2026}. Your team keeps full access until then.',
            'Best regards,\nThe Support Team',
          ],
        },
        {
          id: '#4809',
          title: 'Login failure',
          who: 'Aiko Tanaka',
          email: 'aiko.tanaka@mail.com',
          ago: '24m ago',
          status: 'info',
          decision: 'Send a password reset link',
          summary: [
            {
              label: 'Failed attempts',
              value: '6',
              mono: true,
            },
            {
              label: 'Last success',
              value: '19 Sep 2026',
            },
          ],
          subject: 'Re: Can’t log in',
          version: 'v1 · 13:40',
          sources: 'auth log',
          body: [
            'Hi Aiko,',
            'I’ve sent a password reset link to this address. It stays valid for {30 min}.',
            'Best regards,\nThe Support Team',
          ],
        },
        {
          id: '#4806',
          title: 'Duplicate charge',
          who: 'Jonas Weber',
          email: 'jonas.weber@mail.com',
          ago: '1h ago',
          status: 'success',
          decision: 'Duplicate charge refunded',
          summary: [
            {
              label: 'Refunded',
              value: '$29.00',
              mono: true,
            },
          ],
          subject: 'Re: Charged twice',
          version: 'sent · 13:02',
          sources: 'billing log',
          body: [
            'Hi Jonas,',
            'I’ve refunded the duplicate charge of {$29.00}.',
            'Best regards,\nThe Support Team',
          ],
        },
        {
          id: '#4803',
          title: 'Chargeback notice',
          who: 'Maya Ortiz',
          email: 'maya.ortiz@mail.com',
          ago: '2h ago',
          status: 'error',
          decision: 'Escalated to billing lead',
          summary: [
            {
              label: 'Disputed',
              value: '$120.00',
              mono: true,
            },
            {
              label: 'Respond by',
              value: '4 Oct 2026',
            },
          ],
          subject: 'Chargeback case CB-2231',
          version: 'held',
          sources: 'payment processor notice',
          body: ['Maelle held this reply. Chargebacks need a person to respond.'],
        },
      ]
    })()
  } catch (e) {
    __ds_ns.__errors.push({
      path: 'ui_kits/approvals/data.js',
      error: String((e && e.message) || e),
    })
  }

  __ds_ns.Button = __ds_scope.Button

  __ds_ns.Provenance = __ds_scope.Provenance

  __ds_ns.Wordmark = __ds_scope.Wordmark

  __ds_ns.KeyValueList = __ds_scope.KeyValueList

  __ds_ns.TicketRow = __ds_scope.TicketRow

  __ds_ns.StatusPill = __ds_scope.StatusPill

  __ds_ns.Panel = __ds_scope.Panel

  __ds_ns.PanelHeader = __ds_scope.PanelHeader

  __ds_ns.Eyebrow = __ds_scope.Eyebrow

  __ds_ns.Mono = __ds_scope.Mono
})()
