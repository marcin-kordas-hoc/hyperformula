/**
 * @license
 * Copyright (c) 2025 Handsoncode. All rights reserved.
 */

import {ArraySize} from '../../ArraySize'
import {CellError, ErrorType} from '../../Cell'
import {ErrorMessage} from '../../error-message'
import {AstNodeType, ProcedureAst} from '../../parser'
import {coerceScalarToBoolean, normalizeString} from '../ArithmeticHelper'
import {InterpreterState} from '../InterpreterState'
import {EmptyValue, getRawValue, InternalNoErrorScalarValue, InternalScalarValue, InterpreterValue, isExtendedNumber} from '../InterpreterValue'
import {SimpleRangeValue} from '../../SimpleRangeValue'
import {FunctionArgumentType, FunctionPlugin, FunctionPluginTypecheck, ImplementedFunctions} from './FunctionPlugin'

export class ArrayPlugin extends FunctionPlugin implements FunctionPluginTypecheck<ArrayPlugin> {
  public static implementedFunctions: ImplementedFunctions = {
    'ARRAYFORMULA': {
      method: 'arrayformula',
      sizeOfResultArrayMethod: 'arrayformulaArraySize',
      enableArrayArithmeticForArguments: true,
      parameters: [
        {argumentType: FunctionArgumentType.ANY}
      ],
    },
    'ARRAY_CONSTRAIN': {
      method: 'arrayconstrain',
      sizeOfResultArrayMethod: 'arrayconstrainArraySize',
      parameters: [
        {argumentType: FunctionArgumentType.RANGE},
        {argumentType: FunctionArgumentType.INTEGER, minValue: 1},
        {argumentType: FunctionArgumentType.INTEGER, minValue: 1},
      ],
      vectorizationForbidden: true,
    },
    'FILTER': {
      method: 'filter',
      sizeOfResultArrayMethod: 'filterArraySize',
      enableArrayArithmeticForArguments: true,
      parameters: [
        {argumentType: FunctionArgumentType.RANGE},
        {argumentType: FunctionArgumentType.RANGE},
      ],
      repeatLastArgs: 1,
    },
    'VSTACK': {
      method: 'vstack',
      sizeOfResultArrayMethod: 'vstackArraySize',
      enableArrayArithmeticForArguments: true,
      parameters: [
        {argumentType: FunctionArgumentType.RANGE},
      ],
      repeatLastArgs: 1,
    },
    'HSTACK': {
      method: 'hstack',
      sizeOfResultArrayMethod: 'hstackArraySize',
      enableArrayArithmeticForArguments: true,
      parameters: [
        {argumentType: FunctionArgumentType.RANGE},
      ],
      repeatLastArgs: 1,
    },
    'UNIQUE': {
      method: 'unique',
      sizeOfResultArrayMethod: 'uniqueArraySize',
      enableArrayArithmeticForArguments: true,
      parameters: [
        {argumentType: FunctionArgumentType.RANGE},
        {argumentType: FunctionArgumentType.BOOLEAN, defaultValue: false, emptyAsDefault: true},
        {argumentType: FunctionArgumentType.BOOLEAN, defaultValue: false, emptyAsDefault: true},
      ],
      vectorizationForbidden: true,
    },
  }

  public arrayformula(ast: ProcedureAst, state: InterpreterState): InterpreterValue {
    return this.runFunction(ast.args, state, this.metadata('ARRAYFORMULA'), (value) => value)
  }

  public arrayformulaArraySize(ast: ProcedureAst, state: InterpreterState): ArraySize {
    if (ast.args.length !== 1) {
      return ArraySize.error()
    }

    const metadata = this.metadata('ARRAYFORMULA')
    const subChecks = ast.args.map((arg) => this.arraySizeForAst(arg, new InterpreterState(state.formulaAddress, state.arraysFlag || (metadata?.enableArrayArithmeticForArguments ?? false))))

    return subChecks[0]
  }

  public arrayconstrain(ast: ProcedureAst, state: InterpreterState): InterpreterValue {
    return this.runFunction(ast.args, state, this.metadata('ARRAY_CONSTRAIN'), (range: SimpleRangeValue, numRows: number, numCols: number) => {
      numRows = Math.min(numRows, range.height())
      numCols = Math.min(numCols, range.width())
      const data: InternalScalarValue[][] = range.data
      const ret: InternalScalarValue[][] = []
      for (let i = 0; i < numRows; i++) {
        ret.push(data[i].slice(0, numCols))
      }
      return SimpleRangeValue.onlyValues(ret)
    })
  }

  public arrayconstrainArraySize(ast: ProcedureAst, state: InterpreterState): ArraySize {
    if (ast.args.length !== 3) {
      return ArraySize.error()
    }

    const metadata = this.metadata('ARRAY_CONSTRAIN')
    const subChecks = ast.args.map((arg) => this.arraySizeForAst(arg, new InterpreterState(state.formulaAddress, state.arraysFlag || (metadata?.enableArrayArithmeticForArguments ?? false))))

    let {height, width} = subChecks[0]
    if (ast.args[1].type === AstNodeType.NUMBER) {
      height = Math.min(height, ast.args[1].value)
    }
    if (ast.args[2].type === AstNodeType.NUMBER) {
      width = Math.min(width, ast.args[2].value)
    }
    if (height < 1 || width < 1 || !Number.isInteger(height) || !Number.isInteger(width)) {
      return ArraySize.error()
    }
    return new ArraySize(width, height)
  }

  public filter(ast: ProcedureAst, state: InterpreterState): InterpreterValue {
    return this.runFunction(ast.args, state, this.metadata('FILTER'), (rangeVals: SimpleRangeValue, ...rangeFilters: SimpleRangeValue[]) => {
      for (const filter of rangeFilters) {
        if (rangeVals.width() !== filter.width() || rangeVals.height() !== filter.height()) {
          return new CellError(ErrorType.NA, ErrorMessage.EqualLength)
        }
      }

      if (rangeVals.width() > 1 && rangeVals.height() > 1) {
        return new CellError(ErrorType.NA, ErrorMessage.WrongDimension)
      }

      const vals = rangeVals.data
      const ret = []
      for (let i = 0; i < rangeVals.height(); i++) {
        const row = []
        for (let j = 0; j < rangeVals.width(); j++) {
          let ok = true
          for (const filter of rangeFilters) {
            const val = coerceScalarToBoolean(filter.data[i][j])
            if (val !== true) {
              ok = false
              break
            }
          }
          if (ok) {
            row.push(vals[i][j])
          }
        }
        if (row.length > 0) {
          ret.push(row)
        }
      }
      if (ret.length > 0) {
        return SimpleRangeValue.onlyValues(ret)
      } else {
        return new CellError(ErrorType.NA, ErrorMessage.EmptyRange)
      }
    })
  }

  public filterArraySize(ast: ProcedureAst, state: InterpreterState): ArraySize {
    if (ast.args.length <= 1) {
      return ArraySize.error()
    }

    const metadata = this.metadata('FILTER')
    const subChecks = ast.args.map((arg) => this.arraySizeForAst(arg, new InterpreterState(state.formulaAddress, state.arraysFlag || (metadata?.enableArrayArithmeticForArguments ?? false))))

    const width = Math.max(...(subChecks).map(val => val.width))
    const height = Math.max(...(subChecks).map(val => val.height))
    return new ArraySize(width, height)
  }

  /**
   * Corresponds to VSTACK(array1, [array2], ...)
   *
   * Stacks the input arrays vertically, one on top of another, into a single array.
   * The result has as many rows as the inputs combined and as many columns as the
   * widest input. Cells of narrower inputs are padded on the right with the #N/A
   * error, matching the behaviour of Excel and Google Sheets.
   *
   * @param ast
   * @param state
   */
  public vstack(ast: ProcedureAst, state: InterpreterState): InterpreterValue {
    return this.runFunction(ast.args, state, this.metadata('VSTACK'), (...ranges: SimpleRangeValue[]) => {
      const width = Math.max(...ranges.map(range => range.width()))
      const result: InternalScalarValue[][] = []

      for (const range of ranges) {
        for (const row of range.data) {
          result.push(this.padRowToWidth(row, width))
        }
      }

      return SimpleRangeValue.onlyValues(result)
    })
  }

  /**
   * Calculates the spilled array size of VSTACK: the width is the widest input
   * and the height is the sum of all input heights.
   *
   * @param ast
   * @param state
   */
  public vstackArraySize(ast: ProcedureAst, state: InterpreterState): ArraySize {
    if (ast.args.length < 1) {
      return ArraySize.error()
    }

    const subChecks = this.stackSubChecks(ast, state, 'VSTACK')
    const width = Math.max(...subChecks.map(size => size.width))
    const height = subChecks.reduce((total, size) => total + size.height, 0)
    return new ArraySize(width, height)
  }

  /**
   * Corresponds to HSTACK(array1, [array2], ...)
   *
   * Stacks the input arrays horizontally, side by side, into a single array.
   * The result has as many columns as the inputs combined and as many rows as the
   * tallest input. Cells of shorter inputs are padded at the bottom with the #N/A
   * error, matching the behaviour of Excel and Google Sheets.
   *
   * @param ast
   * @param state
   */
  public hstack(ast: ProcedureAst, state: InterpreterState): InterpreterValue {
    return this.runFunction(ast.args, state, this.metadata('HSTACK'), (...ranges: SimpleRangeValue[]) => {
      const height = Math.max(...ranges.map(range => range.height()))
      const result: InternalScalarValue[][] = [...Array(height).keys()].map(() => [])

      for (const range of ranges) {
        const data = range.data
        const width = range.width()
        for (let row = 0; row < height; row++) {
          const sourceRow = row < data.length ? data[row] : undefined
          for (let col = 0; col < width; col++) {
            // Pad both missing rows (sourceRow === undefined) and short rows
            // (col beyond the row's length) with #N/A, exactly as VSTACK does.
            result[row].push(sourceRow !== undefined && col < sourceRow.length
              ? sourceRow[col]
              : new CellError(ErrorType.NA, ErrorMessage.ValueNotFound))
          }
        }
      }

      return SimpleRangeValue.onlyValues(result)
    })
  }

  /**
   * Calculates the spilled array size of HSTACK: the width is the sum of all
   * input widths and the height is the tallest input.
   *
   * @param ast
   * @param state
   */
  public hstackArraySize(ast: ProcedureAst, state: InterpreterState): ArraySize {
    if (ast.args.length < 1) {
      return ArraySize.error()
    }

    const subChecks = this.stackSubChecks(ast, state, 'HSTACK')
    const width = subChecks.reduce((total, size) => total + size.width, 0)
    const height = Math.max(...subChecks.map(size => size.height))
    return new ArraySize(width, height)
  }

  /**
   * Corresponds to UNIQUE(array, [by_col], [exactly_once]).
   *
   * Returns the distinct rows of `array` (or its distinct columns when `by_col`
   * is TRUE), preserving the order of first occurrence. When `exactly_once` is
   * TRUE only the rows/columns that occur exactly once are returned. Value
   * equality is delegated to {@link ArithmeticHelper}, so it honours the
   * `caseSensitive` and `accentSensitive` config options (case-insensitive by
   * default) and the engine's mixed-type equality rules; repeated empty cells
   * therefore collapse to a single entry. An error anywhere in the input range
   * is propagated. HyperFormula has no #CALC!, so an empty result is reported as
   * #N/A (EmptyRange), mirroring FILTER.
   *
   * @param ast - the parsed function-call AST node
   * @param state - current interpreter evaluation state
   */
  public unique(ast: ProcedureAst, state: InterpreterState): InterpreterValue {
    return this.runFunction(ast.args, state, this.metadata('UNIQUE'),
      (range: SimpleRangeValue, byCol: boolean, exactlyOnce: boolean) => {
        const data = range.data

        const firstError = this.findFirstError(data)
        if (firstError !== undefined) {
          return firstError
        }

        // An empty input range (e.g. a whole-column reference to an empty sheet)
        // has no rows/columns to keep. Return #N/A rather than letting the empty
        // 2-D array reach SimpleRangeValue.onlyValues. Mirrors FILTER/SORT.
        if (data.length === 0 || data[0].length === 0) {
          return new CellError(ErrorType.NA, ErrorMessage.EmptyRange)
        }

        const height = range.height()
        const width = range.width()

        // The lines being deduped are rows by default, or columns when by_col.
        const lines: InternalScalarValue[][] = byCol
          ? Array.from({length: width}, (_, c) => data.map(row => row[c]))
          : data.map(row => row.slice())

        // First-occurrence dedupe: keep one representative per distinct line and
        // count how many times each occurs (needed for exactly_once). A hash of
        // each line (see lineKey) buckets candidates so we only run the exact
        // ArithmeticHelper equality against representatives that share a key,
        // turning the naive O(lines²) scan into an O(lines) pass. The key folds
        // in the same caseSensitive/accentSensitive rules the comparator uses,
        // so equal lines always land in the same bucket; linesEqual remains the
        // authority, so any key collision is still resolved correctly.
        const representatives: InternalScalarValue[][] = []
        const occurrences: number[] = []
        const bucketsByKey = new Map<string, number[]>()
        for (const line of lines) {
          const key = this.lineKey(line)
          const bucket = bucketsByKey.get(key)
          const index = bucket === undefined
            ? -1
            : (bucket.find(i => this.linesEqual(representatives[i], line)) ?? -1)
          if (index === -1) {
            const newIndex = representatives.length
            representatives.push(line)
            occurrences.push(1)
            if (bucket === undefined) {
              bucketsByKey.set(key, [newIndex])
            } else {
              bucket.push(newIndex)
            }
          } else {
            occurrences[index] += 1
          }
        }

        const kept = representatives.filter((_, i) => !exactlyOnce || occurrences[i] === 1)
        if (kept.length === 0) {
          return new CellError(ErrorType.NA, ErrorMessage.EmptyRange)
        }

        // Reassemble: kept lines are rows (default) or columns (by_col).
        const result: InternalScalarValue[][] = byCol
          ? Array.from({length: height}, (_, r) => kept.map(column => column[r]))
          : kept
        return SimpleRangeValue.onlyValues(result)
      }
    )
  }

  /**
   * Predicts the output array size for UNIQUE at parse time. The result never
   * has more rows/columns than the input (every line distinct), so the input
   * shape is the maximum spill footprint. A fresh {@link ArraySize} is returned
   * so the input's `isRef` flag is not propagated — a ref-flagged size is
   * treated as scalar and would collapse the spilled result into a single cell.
   *
   * @param ast - the parsed function-call AST node
   * @param state - current interpreter evaluation state
   */
  public uniqueArraySize(ast: ProcedureAst, state: InterpreterState): ArraySize {
    if (ast.args.length < 1 || ast.args.length > 3) {
      return ArraySize.error()
    }

    const metadata = this.metadata('UNIQUE')
    const subChecks = ast.args.map((arg) => this.arraySizeForAst(arg, new InterpreterState(state.formulaAddress, state.arraysFlag || (metadata?.enableArrayArithmeticForArguments ?? false))))
    return new ArraySize(subChecks[0].width, subChecks[0].height)
  }

  /** Returns the first {@link CellError} found in a 2-D array, or undefined. */
  private findFirstError(data: InternalScalarValue[][]): CellError | undefined {
    for (const row of data) {
      for (const cell of row) {
        if (cell instanceof CellError) {
          return cell
        }
      }
    }
    return undefined
  }

  /**
   * Two lines are equal when they have the same length and every cell pair is
   * equal under {@link ArithmeticHelper.eq} (which honours caseSensitive /
   * accentSensitive). Callers must strip errors first, so cells are cast to the
   * error-free scalar type.
   *
   * @param left - the stored representative line
   * @param right - the candidate line being tested for duplication
   */
  private linesEqual(left: InternalScalarValue[], right: InternalScalarValue[]): boolean {
    if (left.length !== right.length) {
      return false
    }
    return left.every((cell, i) => this.arithmeticHelper.eq(
      cell as InternalNoErrorScalarValue,
      right[i] as InternalNoErrorScalarValue,
    ))
  }

  /**
   * Builds a string key that groups lines which {@link linesEqual} may consider
   * equal into the same hash bucket. Each cell is keyed by a type tag plus a
   * normalized payload, and the cell keys are joined into a line key. The key is
   * a fast pre-filter, not a decision: {@link unique} still confirms every
   * candidate with `linesEqual`, so a key collision only widens a bucket, it
   * never merges distinct lines.
   *
   * @param line - the row (or column) whose cells are hashed
   */
  private lineKey(line: InternalScalarValue[]): string {
    return line.map(cell => this.cellKey(cell)).join(' ')
  }

  /**
   * Keys a single cell for {@link lineKey}. Strings are folded with the same
   * caseSensitive / accentSensitive rules {@link ArithmeticHelper} applies, so
   * values the comparator treats as equal (e.g. "Apple"/"apple" by default)
   * produce the same key; numbers are keyed by their raw value so rich-number
   * wrappers (dates, currency, …) collide with the plain number they equal.
   *
   * @param cell - the scalar value to key (errors are stripped by the caller)
   */
  private cellKey(cell: InternalScalarValue): string {
    if (cell === EmptyValue) {
      return 'e'
    }
    if (typeof cell === 'string') {
      return `s:${this.foldString(cell)}`
    }
    if (typeof cell === 'boolean') {
      return cell ? 'b:1' : 'b:0'
    }
    if (isExtendedNumber(cell)) {
      return `n:${getRawValue(cell)}`
    }
    return `x:${String(cell)}`
  }

  /**
   * Applies the case- and accent-folding used by {@link ArithmeticHelper} when
   * comparing strings, mirroring its private `normalizeString`: lower-case when
   * the engine is case-insensitive, then strip combining marks when it is
   * accent-insensitive.
   *
   * @param str - the string to fold
   */
  private foldString(str: string): string {
    let folded = str
    if (!this.config.caseSensitive) {
      folded = folded.toLowerCase()
    }
    if (!this.config.accentSensitive) {
      folded = Array.from(normalizeString(folded, 'nfd'))
        .filter(char => {
          const code = char.charCodeAt(0)
          return code < 0x300 || code > 0x36f
        })
        .join('')
    }
    return folded
  }

  /**
   * Resolves the array size of every argument of a stacking function, enabling
   * array arithmetic for the arguments when the function's metadata requests it.
   *
   * @param ast
   * @param state
   * @param functionName - the stacking function whose metadata drives the array-arithmetic flag
   */
  private stackSubChecks(ast: ProcedureAst, state: InterpreterState, functionName: 'VSTACK' | 'HSTACK'): ArraySize[] {
    const metadata = this.metadata(functionName)
    return ast.args.map((arg) => this.arraySizeForAst(arg, new InterpreterState(state.formulaAddress, state.arraysFlag || (metadata?.enableArrayArithmeticForArguments ?? false))))
  }

  /**
   * Returns a copy of the given row resized to exactly `width` cells: longer
   * rows are truncated and shorter rows are padded on the right with #N/A. Used
   * by VSTACK to align every stacked row to the widest input.
   *
   * @param row - the source row to resize
   * @param width - the target number of cells
   */
  private padRowToWidth(row: InternalScalarValue[], width: number): InternalScalarValue[] {
    if (row.length >= width) {
      return row.slice(0, width)
    }
    const padded = row.slice()
    while (padded.length < width) {
      padded.push(new CellError(ErrorType.NA, ErrorMessage.ValueNotFound))
    }
    return padded
  }
}
