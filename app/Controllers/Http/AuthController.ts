import type { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
// import Database from '@ioc:Adonis/Lucid/Database'
import { schema, rules } from '@ioc:Adonis/Core/Validator'
import Mail from '@ioc:Adonis/Addons/Mail'

import User from 'App/Models/User'
import Address from 'App/Models/Address'
// import UserValidator from 'App/Validators/UserValidator'
import Env from '@ioc:Adonis/Core/Env'
import UserRepository from 'App/Repositories/UserRepository'
import CustomHandlerException from 'App/Exceptions/CustomHandlerException'
import Hash from '@ioc:Adonis/Core/Hash'
// import AddressValidator from 'App/Validators/AddressValidator'
import RegisterValidator from 'App/Validators/RegisterValidator'
import Application from '@ioc:Adonis/Core/Application'
import AddressRepository from 'App/Repositories/AddressRepository'
import Role from 'App/Models/Role'

export default class AuthController {
  protected userRepository: UserRepository
  protected addressRepository: AddressRepository

  constructor() {
    this.userRepository = new UserRepository()
    this.addressRepository = new AddressRepository()
  }

  public async register({ request, response }: HttpContextContract) {
    await request.validate(RegisterValidator)

    if (await this.userRepository.checkRolesAdmin(request.input('role_id'))) {
      return response
        .status(422)
        .json({ status: 'error', message: 'Cannot Use this Roles', data: '' })
    }

    try {
      const verificationCode: string =
        Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

      const user = await User.create({
        name: request.input('name'),
        email: request.input('email'),
        username: request.input('username'),
        password: request.input('password'),
        role_id: request.input('role_id'),
        verification_code: verificationCode,
        isVerified: true,
      })

      if (user) {
        await Address.create({
          user_id: user.id,
          address: request.input('address'),
          regencies_id: request.input('villages_id'),
          villages_id: request.input('districts_id'),
          districts_id: request.input('regencies_id'),
          provinces_id: request.input('provinces_id'),
          latitude: request.input('latitude'),
          longitude: request.input('longitude'),
        })
      }

      // const completeUrl = request.completeUrl()
      // const url = completeUrl.split('/')
      // const protocol = url[0]
      // const domain = url[2]

      // await Mail.send((message) => {
      //   message
      //     .from(Env.get('MAIL_FROM_ADDRESS'))
      //     .to(user.email)
      //     .subject('Verify your email')
      //     .htmlView('email/verification', {
      //       verificationCode: verificationCode,
      //       domain: domain,
      //       protocol: protocol,
      //     })
      // })

      response.created({
        status: 'success',
        message: 'Register Successfully',
        data: {
          name: user.name,
          email: user.email,
          is_verified: user.isVerified,
        },
      })
    } catch (error) {
      return response.status(422).json({ status: 'error', message: error.message, data: '' })
    }
  }

  public async login({ request, response, auth }: HttpContextContract) {
    const userSchema = schema.create({
      username: schema.string({ trim: true }),
      password: schema.string({ trim: true }),
    })
    try {
      await request.validate({ schema: userSchema })
      const { username, password } = request.all()

      const user = await User.query().where('email', username).orWhere('username', username).first()

      if (!user) {
        return response
          .status(422)
          .json({ status: 'error', message: 'Username or Email not Found', data: '' })
      }

      // Verify password
      if (!(await Hash.verify(user.password, password))) {
        return response
          .status(422)
          .json({ status: 'error', message: 'Invalid credentials', data: '' })
      }

      const token = await auth.use('api').generate(user, {
        expiresIn: '720mins',
      })

      return response.json({
        status: 'success',
        message: 'Login Successfully',
        data: token,
      })
    } catch (error) {
      return response.status(422).json({ status: 'error', message: error.message, data: '' })
    }
  }

  // Need Update
  public async update({ request, response, auth }: HttpContextContract) {
    const user = await auth.authenticate()

    if (request.input('username')) {
      const userSchema = schema.create({
        username: schema.string({}, [
          rules.unique({ table: 'users', column: 'username' }),
          rules.minLength(6),
        ]),
      })
      await request.validate({ schema: userSchema })
    }

    const avatar = request.file('avatar', {
      size: '2mb',
      extnames: ['jpg', 'png'],
    })
    let fileName = 'avatar-' + user.username
    let fullName
    if (avatar) {
      await avatar.move(Application.tmpPath('uploads/images/avatar'), {
        name: fileName + '.' + avatar.extname,
      })
      fullName = fileName + '.' + avatar.extname
    }

    let userData = {
      name: request.input('name'),
      username: request.input('username'),
      email: request.input('email'),
      password: request.input('password'),
    }

    if (fullName) {
      let avatar = { avatar: fullName }
      userData = { ...userData, ...avatar }
    }

    const addressData = {
      address: request.input('address'),
      regencies_id: request.input('villages_id'),
      villages_id: request.input('districts_id'),
      districts_id: request.input('regencies_id'),
      provinces_id: request.input('provinces_id'),
      latitude: request.input('latitude'),
      longitude: request.input('longitude'),
    }

    try {
      if (Object.keys(userData).length !== 0) {
        await User.query().where('id', user.id).update(userData)
      }
      if (Object.keys(addressData).length !== 0) {
        await Address.query().where('user_id', user.id).update(addressData)
      }

      return response.status(202).json({
        status: 'success',
        message: 'Update Data Successfully',
        data: '',
      })
    } catch (error) {
      return response.status(422).json({ status: 'error', message: error.message, data: '' })
    }
  }

  public async user({ response, auth }: HttpContextContract) {
    const user = await auth.authenticate()

    let userData = await User.query().where('id', user.id).preload('address').first()

    let role = await Role.query().where('id', user.role_id).first()

    let userAddress = await Address.query().where('user_id', user.id).first()

    if (!userData) {
      return response.status(404).json({ status: 'error', message: 'User Not Found', data: '' })
    }

    const regionalAddress = await this.addressRepository.getAddress(
      userData.address.villages_id,
      userData.address.districts_id,
      userData.address.regencies_id,
      userData.address.provinces_id
    )
    let address = { ...userAddress?.$original, ...regionalAddress }
    let data = { ...userData.$original, role, address }

    return response.json({
      message: 'Get User Successfully',
      data: data,
    })
  }

  public async verify({ response, params }: HttpContextContract) {
    const { verificationCode } = params
    const user = await User.findBy('verification_code', verificationCode)
    if (!user) {
      return response.status(422).json({ errors: ['Invalid verification code'] })
    }
    user.isVerified = true
    user.verification_code = ''
    await user.save()
    return response.json({
      message: 'Verification Successfully',
      data: user,
    })
  }

  public async resendVerification({ request, response }: HttpContextContract) {
    let email = request.input('email')

    try {
      const user = await User.findBy('email', email)

      if (!user) {
        return response.status(422).json({ errors: ['Invalid email'] })
      }

      if (user.isVerified) {
        return response.status(422).json({ errors: ['Email already verified'] })
      }

      const verificationCode: string =
        Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

      user.verification_code = verificationCode
      await user.save()

      const completeUrl = request.completeUrl()
      const url = completeUrl.split('/')
      const protocol = url[0]
      const domain = url[2]

      await Mail.send((message) => {
        message
          .from(Env.get('MAIL_FROM_ADDRESS'))
          .to(user.email)
          .subject('Verify your email')
          .htmlView('email/verification', {
            verificationCode: verificationCode,
            domain: domain,
            protocol: protocol,
          })
      })

      return response.ok({ message: 'Verification code sent successfully' })
    } catch (error) {
      return response.status(422).json({ errors: error })
    }
  }

  public async logout({ auth, response }: HttpContextContract) {
    const user = await auth.logout()

    return response.json({
      message: 'Logout Success',
    })
  }
}
