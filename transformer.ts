/**
 * there are some helper functions for `Field` decorator (ref to decorator/Field.ts),
 * it can be used to transform the data type of the property when serialization/deserialization.
 * @example:
 * import Field from 'decorator/Field'
 * import { dateTransformer } from 'utils/transformer'
 *
 * @Field({ transform: dateTransformer('yyyy-MM-dd') })
 */

/**
 * !!!! ATTENTION !!!!
 * 
 * every transformer function should handle 3 cases maybe happen: 
 * 1. instance to plain object
 * 2. plain object to instance
 * 3. instance to instance (clone)
 * 
 * Keep attention to the edge cases (null/undefined or others), avoid producing errors, or it will break the normal code flow, and lead to an unexpected result.
 * While handling the 3rd case above (triggered by `instanceToInstance`), please return the deep cloned value.
 * 
 * !!!! ATTENTION !!!!
 */

import {
  ClassConstructor,
  TransformFnParams,
  TransformationType,
  instanceToPlain,
  plainToInstance
} from 'class-transformer'
import dayjs, { Dayjs } from 'dayjs'

/**
* transform pure string to Dayjs, or Dayjs to string with forwarded format
* @param format forwarded format string after serialization
* @see https://dayjs.gitee.io/docs/en/display/format
*/
export function dateTransformer(format: string) {
  return (params: TransformFnParams) => {
      const { value, type } = params
      if (!value) {
          return value
      }
      let toArray = Array.isArray(value) ? value : [value]
      if (type === TransformationType.CLASS_TO_PLAIN) {
          toArray = toArray.map((v) => (v as dayjs.Dayjs).format(format))
      } else if (type === TransformationType.PLAIN_TO_CLASS) {
          toArray = toArray.map((v) => dayjs(v.replace(/-/g, '/')))
      } else {
        toArray = toArray.map((v: Dayjs) => v.clone())
      }
      return Array.isArray(value) ? toArray : toArray[0]
  }
}

/**
* this transformer is only used for class-transformer, never use it in other places
* @see decorator/Field.ts
*/
export function typeTransformer(cls: ClassConstructor<unknown>) {
  return (params: TransformFnParams) => {
      const { value, type } = params
      if (!value) {
          return value
      }
      if (type === TransformationType.CLASS_TO_PLAIN) {
          return instanceToPlain(value)
      }
      if (type === TransformationType.PLAIN_TO_CLASS) {
          return plainToInstance(cls, value)
      }
      return value
  }
}
