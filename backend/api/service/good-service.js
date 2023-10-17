const db = require('../db');
const fs = require('fs');
const path = require('path');
const uuid = require('uuid');
const sharp = require('sharp');
const ApiError = require('../exceptions/api-error');

class GoodService {
  async getGoods({ category_id, filters }) {
    filters = filters.split(';');
    if (!filters || filters.length === 0) {
      return this.getGoodsByCategory(category_id);
    } else {
      const placeholders = filters.map((_, index) => `$${index + 1}`).join(', ');
      const goods = await db.query(
        `SELECT DISTINCT * FROM goods RIGHT JOIN good_categories ON good_categories.good_id=goods.id_good INNER JOIN good_features ON goods.id_good = good_features.good_id WHERE id_feature IN (${placeholders}) AND category_id = $${placeholders.length}`,
        [...filters, category_id],
      );
      return goods.rows;
    }
  }
  async getGoodsByCategory(category_id) {
    if (!category_id) {
      const goods = await db.query(`SELECT * FROM goods`);
      return goods.rows;
    } else {
      const goods = await db.query(
        `SELECT DISTINCT * FROM goods RIGHT JOIN good_categories ON good_categories.good_id=goods.id_good WHERE category_id = $1`,
        [category_id],
      );
      return goods.rows;
    }
  }
  async getBrands({ category_id }) {
    const brandsFromDb = await db.query(`SELECT * FROM brands`);
    if (category_id) {
      const goods = await this.getGoodsByCategory(category_id);
      let brands = [];
      for (let i in goods.rows) {
        const good = goods.rows[i];
        if (!brands.find((brand) => brand.id_brand === good.brand_id))
          brands.push(brandsFromDb.find((brand) => brand.id_brand === good.brand_id));
      }
      return brands;
    } else return brandsFromDb.rows;
  }
  async getFilters({ category_id }) {
    const goods = await this.getGoodsByCategory(category_id);
    const filters = new Object();
    for (let i in goods.rows) {
      const good_id = goods.rows[i].id_good;
      const features = await db.query(`SELECT * FROM good_features WHERE good_id = $1`, [good_id]);
      for (let featureIndex in features.rows) {
        const feature = features.rows[featureIndex];
        if (!filters[feature.title]) {
          filters[feature.title] = new Array();
          filters[feature.title].push({ id: feature.id_feature, title: feature.description });
        } else {
          if (!filters[feature.title].find((item) => item.id === feature.id))
            filters[feature.title].push({ id: feature.id_feature, title: feature.description });
        }
      }
    }
    return filters;
  }
  async createGood(
    { good_name, article, price, storage, description, category_id },
    features,
    photos,
  ) {
    if (!good_name) {
      throw ApiError.BadRequest();
    }
    if (!article) {
      throw ApiError.BadRequest();
    }
    if (!price) {
      throw ApiError.BadRequest();
    }
    if (!storage) {
      throw ApiError.BadRequest();
    }
    if (!category_id) {
      throw ApiError.BadRequest();
    }

    await db.query('BEGIN');
    const good = await db.query(
      `INSERT INTO goods(good_name, article, price, storage, description) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [good_name, article, price, storage, description],
    );

    const goodFromDb = await db.query(`SELECT * FROM goods WHERE id_good = $1`, [
      good.rows[0].id_good,
    ]);

    let res = good.rows[0];

    const good_id = good.rows[0].id_good;

    const getCategoryWithParents = async (id) => {
      const category = await db.query(`SELECT * FROM categories WHERE id_category = $1`, [id]);

      if (category.rows.length > 0) {
        const parent = category.rows[0].parent;
        if (parent) {
          const parentCategories = await getCategoryWithParents(parent);
          return [category.rows[0].id_category, ...parentCategories];
        } else {
          return [category.rows[0].id_category];
        }
      } else {
        return [];
      }
    };

    const categories = await getCategoryWithParents(category_id);

    if (categories.length === 0) {
      throw ApiError.BadRequest('Категория не найдена');
    }

    res.categories = categories;

    for (const id of categories) {
      const category = await db.query(
        `INSERT INTO good_categories(category_id, good_id) VALUES ($1, $2) RETURNING *`,
        [id, good_id],
      );
    }

    res.features = [];

    for (const data of features) {
      const featureEncoded = JSON.parse(data);
      console.log('feature', featureEncoded);
      const feature = await db.query(
        `INSERT INTO good_features(title, description, good_id) VALUES ($1, $2, $3) RETURNING *`,
        [featureEncoded.title, featureEncoded.description, good_id],
      );
      res.features.push(feature.rows[0]);
    }

    if (photos && photos.length > 0) {
      res.photos = [];
      const maxSize = 10 * 1024 * 1024; // Максимальный размер файла в байтах (10 МБ)
      for (const photo of photos) {
        let fileName = uuid.v4() + '.jpg';
        const directoryPath = path.resolve(__dirname, '..', 'static/good-photos', String(good_id));

        if (!fs.existsSync(directoryPath)) {
          fs.mkdirSync(directoryPath, { recursive: true });
        }

        const filePath = path.resolve(__dirname, '..', `static/good-photos/${good_id}`, fileName);

        if (photo.size > maxSize) {
          // Изображение превышает максимальный размер, необходимо сжатие
          sharp(photo.data)
            .resize({ width: 800, height: 600 }) // Установите необходимые размеры
            .toFile(filePath, (err, info) => {
              if (err) {
                console.error('Ошибка при сжатии изображения:', err);
                throw ApiError.ServerError('Ошибка при сжатии изображения.');
              }
              console.log('Изображение успешно сжато:', info);
            });
        } else {
          // Изображение не превышает максимальный размер, сохраняем его без изменений
          photo.mv(filePath, (err) => {
            if (err) {
              console.error('Ошибка при сохранении изображения:', err);
              throw ApiError.ServerError('Ошибка при сохранении изображения.');
            }
            console.log('Изображение успешно сохранено');
          });
        }

        const photoDb = await db.query(
          `INSERT INTO good_images(filename, good_id) VALUES ($1, $2) RETURNING *`,
          [fileName, good_id],
        );
        res.photos.push(photoDb.rows[0]);
      }
    }

    await db.query('COMMIT');
    return res;
  }
  async getOneGood() {
    return 0;
  }
  async editGood() {
    return 0;
  }
  async deleteGood() {
    return 0;
  }
}

module.exports = new GoodService();
