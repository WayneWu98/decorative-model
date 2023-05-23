import { ClassConstructor, instanceToPlain, plainToInstance } from 'class-transformer'
import { getModel, Model } from '@/decorator/Model'
import { getField, getFields, Field, getFieldList } from '../decorator/Field'
import { NamingCase, namingCaseFnMap } from '@/naming-case'
import { Validator, getFieldValidators } from '@/decorator/Validator'

let defaultClassNamingCase: NamingCase = NamingCase.camelCase
export const setDefaultClassNamingCase = (namingCase: NamingCase) => defaultClassNamingCase = namingCase

/**
 * Every model should inherit this class.
 */
export default class BaseModel {
  /**
   * instanceToInstance will not convert naming case, call our implementation instead.
   */
  clone() {
    const model = Reflect.getPrototypeOf(this)!.constructor as typeof BaseModel
    return plainToInstance(model, this.toModelPlain(), { ignoreDecorators: true }) as typeof this
  }
  /**
   * Merge target to this in-place, existing properties will be overwritten.
   */
  merge(target: typeof this) {
    return Object.assign(this, target)
  }
  /**
   * Mix target and this to be a new instance.
   */
  mix(target: typeof this) {
    return Object.assign(this.clone(), target)
  }
  /**
   * Convert current model to plain object.
   */
  toPlain(): Object {
    const cls = Reflect.getPrototypeOf(this)!.constructor
    return traverseOnSerialize(instanceToPlain(this), cls, cls)
  }
  /**
   * there are 2 differences to `toPlain`:
   * 
   * 1. no naming-case conversion;
   * 2. no field will be ignore.
   * 
   * For this lib, it is only used in `clone` method.
   */
  toModelPlain() {
    return instanceToPlain(this)
  }
  /**
   * Validate current model **by shallow**, return a list of errors when validate all fields, or a single error message when validate a specific field, empty list or undefined means no error.
   * 
   * Child models **will not** be validated automatically, you should do it yourself.
   */
  validate<T extends BaseModel>(this: T, field: keyof T): Promise<string>
  validate<T extends BaseModel>(this: T): Promise<{ field: keyof T; message: string }[]>
  async validate<T extends BaseModel>(this: T, field?: keyof T) {
    const model = Reflect.getPrototypeOf(this)!.constructor as ClassConstructor<T>
    const validators = {} as Record<keyof typeof this, Validator[]>
    if (field) {
      validators[field] ??= []
      // @ts-ignore
      validators[field].push(...BaseModel.getFieldValidators.call(model, field))
      // Promise.allSettled(validators.map((validator) => validator(this[field], this)))
    } else {
      for (const [k, v] of Object.entries(BaseModel.getAllFieldValidators.call(model))) {
        // @ts-ignore
        validators[k] = v
      }
    }
    const errors = [] as { field: keyof T; message: string }[]
    await Promise.all(
      Object.entries(validators).map(([field, validators]) => {
        return Promise.all(validators.map((validator) => validator(this[field as keyof T], this))).catch(
          // @ts-ignore
          (message: string) => errors.push({ field, message })
        )
      })
    )
    if (field) {
      return errors[0]?.message
    }
    return errors
  }
  static getFieldValidators<T extends ClassConstructor<BaseModel>>(this: T, field: keyof InstanceType<T>) {
    return getFieldValidators(this, field)
  }
  static getAllFieldValidators<T extends ClassConstructor<BaseModel>>(this: T) {
    return getFieldList(this).reduce((map, field) => {
      map[field] = (this as any).getFieldValidators(field)
      return map
    }, {} as Record<keyof InstanceType<T>, Validator[]>)
  }
  static default<T extends ClassConstructor<BaseModel>>(this: T) {
    return new this() as InstanceType<T>
  }
  static getField<T extends ClassConstructor<BaseModel>>(this: T, field: keyof InstanceType<typeof this>) {
    return getField(this, field)
  }
  static getFields<T extends ClassConstructor<BaseModel>>(this: T) {
    return getFields(this)
  }
  static getModel() {
    return getModel(this)
  }
  static from<T extends ClassConstructor<BaseModel>>(this: T, raw: string | Object): InstanceType<T> {
    if (raw instanceof BaseModel) {
      raw = raw.toPlain()
    } else if (typeof raw === 'string') {
      raw = JSON.parse(raw)
    }
    return plainToInstance(this, traverseOnDeserialize(raw, this, this)) as InstanceType<T>
  }
}

function shouldIgnoreSerialize(field?: Field) {
  if (typeof field?.ignore === 'boolean' && field.ignore) {
    return true
  }
  if (typeof field?.ignore === 'object' && field.ignore.onSerialize) {
    return true
  }
  return false
}

// convert naming case to forwarded while serializing
function traverseOnSerialize(obj: any, cls: any, superCls: any): any {
  if (typeof obj !== 'object' || Object.is(obj, null)) {
    // primitive type
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => traverseOnSerialize(item, cls, superCls))
  }
  const transformed: Record<keyof any, any> = {}
  const model: Model = (cls?.getModel?.() ?? superCls?.getModel?.() ?? {}) as Model
  const fields = cls?.getFields?.() ?? {}
  const arrayedFields = Object.values(fields) as Field[]
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    let key = rawKey
    const field = fields[key] as Field
    if (!arrayedFields.some((conf) => conf.fieldName === key)) {
      key = namingCaseFnMap[model?.rename ?? NamingCase.NonCase](key)
    }
    if (shouldIgnoreSerialize(field)) {
      continue
    }
    if (field?.transform) {
      transformed[key] = rawValue
      continue
    }
    const _superCls = cls?.prototype instanceof BaseModel ? cls : superCls
    transformed[key] = traverseOnSerialize(rawValue, fields[rawKey]?.type, _superCls)
  }
  return transformed
}

function shouldIgnoreDeserialize(field?: Field) {
  if (typeof field?.ignore === 'boolean' && field.ignore) {
    return true
  }
  if (typeof field?.ignore === 'object' && field.ignore.onDeserialize) {
    return true
  }
  return false
}

// convert naming case to camel case while deserializing
function traverseOnDeserialize(obj: any, cls: any, superCls: any): any {
  if (typeof obj !== 'object' || Object.is(obj, null)) {
    // primitive type
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => traverseOnDeserialize(item, cls, superCls))
  }
  const transformed: Record<keyof any, any> = {}
  const model = (cls?.getModel?.() ?? superCls?.getModel?.() ?? {}) as Model
  const fields = cls?.getFields?.() ?? {}
  const arrayedFields = Object.values(fields) as Field[]
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    let k = rawKey
    const shouldSkipConvert =
      arrayedFields.some((conf) => conf.fieldName === rawKey) || model?.rename === NamingCase.NonCase
    if (!shouldSkipConvert) {
      k = namingCaseFnMap[defaultClassNamingCase](rawKey)
    }
    const field = fields[k] as Field
    if (shouldIgnoreDeserialize(field)) {
      continue
    }
    if (field?.transform) {
      transformed[k] = rawValue
      continue
    }
    const _superCls = cls?.prototype instanceof BaseModel ? cls : superCls
    transformed[k] = traverseOnDeserialize(rawValue, fields[rawKey]?.type, _superCls)
  }
  return transformed
}
