import '@payloadcms/next/css'
import '../../src/styles/theme.css'
import '../../src/styles/admin.css'
import '../../src/styles/kit.css'
import '../../src/styles/shell-admin.css'
import '../../src/styles/collections-admin.css'
import '../../src/styles/operations-admin.css'
import '../../src/styles/distribution-admin.css'
import '../../src/styles/explorer-admin.css'
import '../../src/styles/content-admin.css'
import '../../src/styles/curations-admin.css'
import '../../src/styles/curation-detail-admin.css'
import '../../src/styles/curation-filters-admin.css'
import '../../src/styles/entities-admin.css'
import '../../src/styles/entity-detail-admin.css'
import '../../src/styles/search-admin.css'
import '../../src/styles/dashboard-admin.css'
import '../../src/styles/login-admin.css'
import config from '@payload-config'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import type { ServerFunctionClient } from 'payload'
import type { ReactNode } from 'react'
import { Cormorant_Garamond, DM_Sans, JetBrains_Mono } from 'next/font/google'
import { importMap } from './admin/importMap.js'

// As três famílias da marca, com os MESMOS pesos que o Collector carrega
// (Cormorant Garamond 500/600 nos títulos, DM Sans 400–700 no corpo, JetBrains
// Mono 400/500 em dados técnicos). Aqui elas são self-hosted pelo `next/font`:
// sem CDN do Google em runtime e sem deslocamento de layout — o Admin deixa de
// renderizar títulos na pilha do sistema e passa a falar a mesma tipografia da
// superfície de referência do produto.
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans-loaded',
  display: 'swap',
})
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-display-loaded',
  display: 'swap',
})
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-loaded',
  display: 'swap',
})

const serverFunction: ServerFunctionClient = async (args) => {
  'use server'
  return handleServerFunctions({ ...args, config, importMap })
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootLayout
      config={config}
      importMap={importMap}
      serverFunction={serverFunction}
      htmlProps={{ className: `${dmSans.variable} ${cormorant.variable} ${jetbrains.variable}` }}
    >
      {children}
    </RootLayout>
  )
}
