/**
 * Copies the node icons next to the compiled files.
 *
 * tsc only emits JavaScript, and n8n resolves `file:sendletter.svg` relative to
 * the compiled node. Without this the node loads with a blank square, which
 * looks broken enough that people assume the package is.
 *
 * A four-line script rather than gulp, because a build tool is a runtime
 * dependency risk and this package publishes with none.
 */
import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist/nodes/SendLetter', { recursive: true })
cpSync('nodes/SendLetter/sendletter.svg', 'dist/nodes/SendLetter/sendletter.svg')
console.log('icons copied')
