import { defineConfig } from 'tsup'

// The bundle inlines Unicode CLDR data, so its notice travels with the code.
const banner = '/*! global-price-parser by DontPayFull. Includes Unicode CLDR data, Copyright © Unicode, Inc., Unicode License v3 (see NOTICE). */'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  banner: { js: banner },
})
