import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../shared/models/models.dart';

/// Everything under /seller/*: the application, documents, listings, auctions and earnings.
class SellerRepository {
  SellerRepository(this._api);

  final ApiClient _api;

  // ── Profile and verification ──

  /// Null when the user has not applied yet.
  Future<SellerProfileModel?> profile() async {
    try {
      return SellerProfileModel.fromJson(asJson((await _api.get('/seller/profile'))['data']));
    } on ApiException catch (e) {
      if (e.code == 'NOT_A_SELLER') return null;
      rethrow;
    }
  }

  Future<void> apply(Json fields) => _api.post('/seller/apply', data: fields);

  Future<void> updateProfile(Json fields) => _api.patch('/seller/profile', data: fields);

  Future<void> uploadDocument(String documentType, XFile file, {void Function(int, int)? onProgress}) async {
    final form = FormData.fromMap({
      'documentType': documentType,
      'file': MultipartFile.fromBytes(await file.readAsBytes(), filename: file.name),
    });
    await _api.upload('/seller/documents', form, onProgress: onProgress);
  }

  Future<void> deleteDocument(String id) => _api.delete('/seller/documents/$id');

  // ── Listings (products) ──

  Future<Paged<ProductModel>> products({String? status, int page = 1}) async =>
      Paged.fromResponse(await _api.get('/seller/products', query: {'status': status, 'page': page}), ProductModel.fromJson);

  Future<ProductModel> product(String id) async => ProductModel.fromJson(asJson((await _api.get('/seller/products/$id'))['data']));

  Future<ProductModel> createProduct(Json fields) async => ProductModel.fromJson(asJson((await _api.post('/seller/products', data: fields))['data']));

  Future<void> updateProduct(String id, Json fields) => _api.patch('/seller/products/$id', data: fields);

  Future<void> deleteProduct(String id) => _api.delete('/seller/products/$id');

  Future<void> submitProduct(String id) => _api.post('/seller/products/$id/submit');

  Future<void> uploadImages(String id, List<XFile> files, {void Function(int, int)? onProgress}) async {
    final form = FormData();
    for (final f in files) {
      form.files.add(MapEntry('images', MultipartFile.fromBytes(await f.readAsBytes(), filename: f.name)));
    }
    await _api.upload('/seller/products/$id/images', form, onProgress: onProgress);
  }

  Future<void> reorderImages(String id, List<String> imageIds) => _api.put('/seller/products/$id/images/order', data: {'imageIds': imageIds});

  Future<void> deleteImage(String id, String imageId) => _api.delete('/seller/products/$id/images/$imageId');

  // ── Auctions ──

  Future<Paged<ManagedAuction>> auctions({String? status, int page = 1}) async =>
      Paged.fromResponse(await _api.get('/seller/auctions', query: {'status': status, 'page': page}), ManagedAuction.fromJson);

  Future<ManagedAuction> createAuction(Json fields) async => ManagedAuction.fromJson(asJson((await _api.post('/seller/auctions', data: fields))['data']));

  Future<void> cancelAuction(String id, String reason) => _api.post('/seller/auctions/$id/cancel', data: {'reason': reason});

  // ── Money ──

  Future<EarningsModel> earnings() async => EarningsModel.fromJson(asJson((await _api.get('/seller/earnings'))['data']));
}

final sellerRepositoryProvider = Provider<SellerRepository>((ref) => SellerRepository(ref.watch(apiClientProvider)));

final sellerProfileProvider = FutureProvider.autoDispose<SellerProfileModel?>((ref) => ref.watch(sellerRepositoryProvider).profile());
final sellerProductsProvider = FutureProvider.autoDispose.family<Paged<ProductModel>, String?>((ref, status) => ref.watch(sellerRepositoryProvider).products(status: status));
final sellerAuctionsProvider = FutureProvider.autoDispose.family<Paged<ManagedAuction>, String?>((ref, status) => ref.watch(sellerRepositoryProvider).auctions(status: status));
final earningsProvider = FutureProvider.autoDispose<EarningsModel>((ref) => ref.watch(sellerRepositoryProvider).earnings());
