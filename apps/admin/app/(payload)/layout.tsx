import '@payloadcms/next/css'
import '../../src/styles/admin.css'
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
import '../../src/styles/content-health-admin.css'
import '../../src/styles/login-admin.css'
import config from '@payload-config'
import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import type { ServerFunctionClient } from 'payload'
import type { ReactNode } from 'react'
import { importMap } from './admin/importMap.js'

const serverFunction: ServerFunctionClient = async (args) => {
  'use server'
  return handleServerFunctions({ ...args, config, importMap })
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  )
}
