// Qual edição está sendo montada: definido na hora de gerar o instalador (EDICAO=completa ou padrao).
export const EDICAO: 'completa' | 'padrao' = typeof __EDICAO__ !== 'undefined' && __EDICAO__ === 'padrao' ? 'padrao' : 'completa'
