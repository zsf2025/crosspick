import { createRegistry } from '../core/registry'
import { scoreTool } from './score'
import { priceTool } from './price'
import { reviewTool } from './review'
import { compareTool } from './compare'
import { reportTool } from './report'
import { mutateTool } from './mutate'

export const ALL_TOOLS = [
  scoreTool,
  priceTool,
  reviewTool,
  compareTool,
  reportTool,
  mutateTool,
]

export function createDefaultRegistry() {
  return createRegistry(ALL_TOOLS)
}

export { scoreTool, priceTool, reviewTool, compareTool, reportTool, mutateTool }
