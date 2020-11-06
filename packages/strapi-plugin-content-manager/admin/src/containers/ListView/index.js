import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators, compose } from 'redux';
import { get, isEmpty } from 'lodash';
import { FormattedMessage, useIntl } from 'react-intl';
import { useHistory, useLocation } from 'react-router-dom';
import { Header } from '@buffetjs/custom';
import isEqual from 'react-fast-compare';
import { stringify } from 'qs';
import {
  PopUpWarning,
  request,
  CheckPermissions,
  useGlobalContext,
  useUserPermissions,
} from 'strapi-helper-plugin';
import pluginId from '../../pluginId';
import pluginPermissions from '../../permissions';
import { useQueryParams } from '../../hooks';
import {
  formatFiltersFromQuery,
  generatePermissionsObject,
  getRequestUrl,
  getTrad,
} from '../../utils';

import DisplayedFieldsDropdown from '../../components/DisplayedFieldsDropdown';
import Container from '../../components/Container';
import CustomTable from '../../components/CustomTable';

import FilterPicker from '../../components/FilterPicker';
import Search from '../../components/Search';
import ListViewProvider from '../ListViewProvider';
import { AddFilterCta, FilterIcon, Wrapper } from './components';
import Filter from './Filter';
import Footer from './Footer';
import {
  getData,
  getDataSucceeded,
  onChangeBulk,
  onChangeBulkSelectall,
  onDeleteDataError,
  onDeleteDataSucceeded,
  onDeleteSeveralDataSucceeded,
  resetProps,
  setModalLoadingState,
  toggleModalDelete,
  toggleModalDeleteAll,
  //
  setLayout,
  onChangeListHeaders,
  onResetListHeaders,
} from './actions';
import makeSelectListView from './selectors';

import { getAllAllowedHeaders, getFirstSortableHeader } from './utils';

/* eslint-disable react/no-array-index-key */

function ListView({
  didDeleteData,

  entriesToDelete,

  onChangeBulk,
  onChangeBulkSelectall,
  onDeleteDataError,
  onDeleteDataSucceeded,
  onDeleteSeveralDataSucceeded,

  setModalLoadingState,
  showWarningDelete,
  showModalConfirmButtonLoading,
  showWarningDeleteAll,
  toggleModalDelete,
  toggleModalDeleteAll,

  // NEW
  // allAllowedHeaders,
  data,
  displayedHeaders,
  getData,
  getDataSucceeded,
  isLoading,
  layout,
  onChangeListHeaders,
  onResetListHeaders,
  pagination: { total },
  resetProps,
  setLayout,
  slug,
}) {
  const {
    contentType: {
      attributes,
      settings: {
        defaultSortBy,
        defaultSortOrder,
        bulkable: isBulkable,
        filterable: isFilterable,
        searchable: isSearchable,
        pageSize: defaultPageSize,
        // mainField,
      },
    },
  } = layout;

  const { emitEvent } = useGlobalContext();
  const emitEventRef = useRef(emitEvent);
  const viewPermissions = useMemo(() => generatePermissionsObject(slug), [slug]);
  const {
    isLoading: isLoadingForPermissions,
    allowedActions: { canCreate, canRead, canUpdate, canDelete },
  } = useUserPermissions(viewPermissions);
  const defaultSort = `${defaultSortBy}:${defaultSortOrder}`;
  const initParams = useMemo(() => ({ page: 1, pageSize: defaultPageSize, _sort: defaultSort }), [
    defaultPageSize,
    defaultSort,
  ]);
  const [{ query, rawQuery }, setQuery] = useQueryParams(initParams);

  const { pathname } = useLocation();
  const { push } = useHistory;
  const { formatMessage } = useIntl();

  const [isFilterPickerOpen, setFilterPickerState] = useState(false);
  const [idToDelete, setIdToDelete] = useState(null);
  const contentType = layout.contentType;
  const hasDraftAndPublish = contentType.options.draftAndPublish;
  const allAllowedHeaders = getAllAllowedHeaders(attributes);

  const filters = useMemo(() => {
    return formatFiltersFromQuery(query);
  }, [query]);

  const _limit = parseInt(query.pageSize, 10);
  const _page = parseInt(query.page, 10);
  const _sort = query._sort;
  const _q = query._q || '';

  const label = contentType.info.label;

  const params = useMemo(() => {
    return rawQuery || `?${stringify(initParams, { encode: false })}`;
  }, [initParams, rawQuery]);

  useEffect(() => {
    setLayout(layout);
    setFilterPickerState(false);

    return () => {
      resetProps();
    };
  }, [layout, setLayout, resetProps]);

  // Using a ref to avoid requests being fired multiple times on slug on change
  // We need it because the hook as mulitple dependencies so it may run when the before the permissions are checked
  const requestUrlRef = useRef('');
  const fetchData = useCallback(
    async (endPoint, abortSignal = false) => {
      getData();
      const signal = abortSignal || new AbortController().signal;

      try {
        const { results, pagination } = await request(endPoint, { method: 'GET', signal });

        getDataSucceeded(pagination, results);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error(err);
          strapi.notification.error(getTrad('error.model.fetch'));
        }
      }
    },
    [getData, getDataSucceeded]
  );

  useEffect(() => {
    const abortController = new AbortController();
    const { signal } = abortController;

    const shouldSendRequest = !isLoadingForPermissions && canRead;
    const requestUrl = `/${pluginId}/collection-types/${slug}${params}`;

    if (shouldSendRequest && requestUrl.includes(requestUrlRef.current)) {
      fetchData(requestUrl, signal);
    }

    return () => {
      requestUrlRef.current = slug;
      abortController.abort();
    };
  }, [isLoadingForPermissions, canRead, getData, slug, params, getDataSucceeded, fetchData]);

  const firstSortableHeader = useMemo(() => getFirstSortableHeader(displayedHeaders), [
    displayedHeaders,
  ]);

  const handleConfirmDeleteData = useCallback(async () => {
    try {
      let trackerProperty = {};

      if (hasDraftAndPublish) {
        const dataToDelete = data.find(obj => obj.id.toString() === idToDelete.toString());
        const isDraftEntry = isEmpty(dataToDelete.published_at);
        const status = isDraftEntry ? 'draft' : 'published';

        trackerProperty = { status };
      }

      emitEvent('willDeleteEntry', trackerProperty);
      setModalLoadingState();

      await request(getRequestUrl(`explorer/${slug}/${idToDelete}`), {
        method: 'DELETE',
      });

      strapi.notification.success(`${pluginId}.success.record.delete`);

      // Close the modal and refetch data
      onDeleteDataSucceeded();
      emitEvent('didDeleteEntry', trackerProperty);
    } catch (err) {
      const errorMessage = get(
        err,
        'response.payload.message',
        formatMessage({ id: `${pluginId}.error.record.delete` })
      );

      strapi.notification.error(errorMessage);
      // Close the modal
      onDeleteDataError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setModalLoadingState, slug, idToDelete, onDeleteDataSucceeded, hasDraftAndPublish, data]);

  const handleConfirmDeleteAllData = useCallback(async () => {
    const params = Object.assign(entriesToDelete);

    try {
      setModalLoadingState();

      await request(getRequestUrl(`explorer/deleteAll/${slug}`), {
        method: 'DELETE',
        params,
      });

      onDeleteSeveralDataSucceeded();
    } catch (err) {
      strapi.notification.error(`${pluginId}.error.record.delete`);
    }
  }, [entriesToDelete, onDeleteSeveralDataSucceeded, slug, setModalLoadingState]);

  const handleChangeListLabels = useCallback(
    ({ name, value }) => {
      // Display a notification if trying to remove the last displayed field
      if (value && displayedHeaders.length === 1) {
        strapi.notification.error('content-manager.notification.error.displayedFields');

        return false;
      }

      emitEventRef.current('didChangeDisplayedFields');

      onChangeListHeaders({ name, value });
    },
    [displayedHeaders, onChangeListHeaders]
  );

  const handleClickDelete = id => {
    setIdToDelete(id);
    toggleModalDelete();
  };

  const handleModalClose = useCallback(() => {
    if (didDeleteData) {
      fetchData();
    }
  }, [fetchData, didDeleteData]);

  const toggleFilterPickerState = useCallback(() => {
    setFilterPickerState(prevState => {
      if (!prevState) {
        emitEventRef.current('willFilterEntries');
      }

      return !prevState;
    });
  }, []);

  const headerAction = useMemo(() => {
    if (!canCreate) {
      return [];
    }

    return [
      {
        label: formatMessage(
          {
            id: 'content-manager.containers.List.addAnEntry',
          },
          {
            entity: label || 'Content Manager',
          }
        ),
        onClick: () => {
          const trackerProperty = hasDraftAndPublish ? { status: 'draft' } : {};

          emitEventRef.current('willCreateEntry', trackerProperty);
          push({
            pathname: `${pathname}/create`,
          });
        },
        color: 'primary',
        type: 'button',
        icon: true,
        style: {
          paddingLeft: 15,
          paddingRight: 15,
          fontWeight: 600,
        },
      },
    ];
  }, [label, pathname, canCreate, formatMessage, hasDraftAndPublish, push]);

  const headerProps = useMemo(() => {
    /* eslint-disable indent */
    return {
      title: {
        label: label || 'Content Manager',
      },
      content: canRead
        ? formatMessage(
            {
              id:
                total > 1
                  ? `${pluginId}.containers.List.pluginHeaderDescription`
                  : `${pluginId}.containers.List.pluginHeaderDescription.singular`,
            },
            { label: total }
          )
        : null,
      actions: headerAction,
    };
  }, [total, headerAction, label, canRead, formatMessage]);

  return (
    <>
      <ListViewProvider
        data={data}
        // TO remove
        count={total}
        //
        entriesToDelete={entriesToDelete}
        emitEvent={emitEvent}
        label={label}
        onChangeBulk={onChangeBulk}
        onChangeBulkSelectall={onChangeBulkSelectall}
        onClickDelete={handleClickDelete}
        // schema={listSchema}
        schema={{}}
        slug={slug}
        toggleModalDeleteAll={toggleModalDeleteAll}
        // TODO TO REMOVE ?
        _limit={_limit}
        _page={_page}
        //
        filters={filters}
        _q={_q}
        _sort={_sort}
        // to keep
        firstSortableHeader={firstSortableHeader}
        setQuery={setQuery}
      >
        <FilterPicker
          contentType={contentType}
          filters={filters}
          isOpen={isFilterPickerOpen}
          name={label}
          toggleFilterPickerState={toggleFilterPickerState}
          setQuery={setQuery}
          slug={slug}
        />
        <Container className="container-fluid">
          {!isFilterPickerOpen && <Header {...headerProps} isLoading={isLoading && canRead} />}
          {isSearchable && canRead && (
            <Search changeParams={setQuery} initValue={_q} model={label} value={_q} />
          )}
          {canRead && (
            <Wrapper>
              <div className="row" style={{ marginBottom: '5px' }}>
                <div className="col-10">
                  <div className="row" style={{ marginLeft: 0, marginRight: 0 }}>
                    {isFilterable && (
                      <>
                        <AddFilterCta type="button" onClick={toggleFilterPickerState}>
                          <FilterIcon />
                          <FormattedMessage id="app.utils.filters" />
                        </AddFilterCta>
                        {filters.map(({ filter: filterName, name }, key) => (
                          <Filter
                            contentType={contentType}
                            filterName={filterName}
                            filters={filters}
                            index={key}
                            key={key}
                            name={name}
                            toggleFilterPickerState={toggleFilterPickerState}
                            isFilterPickerOpen={isFilterPickerOpen}
                            setQuery={setQuery}
                          />
                        ))}
                      </>
                    )}
                  </div>
                </div>
                <div className="col-2">
                  <CheckPermissions permissions={pluginPermissions.collectionTypesConfigurations}>
                    <DisplayedFieldsDropdown
                      displayedHeaders={displayedHeaders}
                      items={allAllowedHeaders}
                      // items={allAllowedHeaders}
                      onChange={handleChangeListLabels}
                      onClickReset={onResetListHeaders}
                      slug={slug}
                    />
                  </CheckPermissions>
                </div>
              </div>
              <div className="row" style={{ paddingTop: '12px' }}>
                <div className="col-12">
                  <CustomTable
                    data={data}
                    canDelete={canDelete}
                    canUpdate={canUpdate}
                    displayedHeaders={displayedHeaders}
                    hasDraftAndPublish={hasDraftAndPublish}
                    isBulkable={isBulkable}
                    // onChangeParams={handleChangeSearch}
                    setQuery={setQuery}
                    showLoader={isLoading}
                  />
                  <Footer count={total} params={query} onChange={setQuery} />
                </div>
              </div>
            </Wrapper>
          )}
        </Container>
        <PopUpWarning
          isOpen={showWarningDelete}
          toggleModal={toggleModalDelete}
          content={{
            message: getTrad('popUpWarning.bodyMessage.contentType.delete'),
          }}
          onConfirm={handleConfirmDeleteData}
          popUpWarningType="danger"
          onClosed={handleModalClose}
          isConfirmButtonLoading={showModalConfirmButtonLoading}
        />
        <PopUpWarning
          isOpen={showWarningDeleteAll}
          toggleModal={toggleModalDeleteAll}
          content={{
            message: getTrad(
              `popUpWarning.bodyMessage.contentType.delete${
                entriesToDelete.length > 1 ? '.all' : ''
              }`
            ),
          }}
          popUpWarningType="danger"
          onConfirm={handleConfirmDeleteAllData}
          onClosed={handleModalClose}
          isConfirmButtonLoading={showModalConfirmButtonLoading}
        />
      </ListViewProvider>
    </>
  );
}
ListView.defaultProps = {
  // layouts: {},
};

ListView.propTypes = {
  // allAllowedHeaders: PropTypes.array.isRequired,
  displayedHeaders: PropTypes.array.isRequired,
  layout: PropTypes.exact({
    components: PropTypes.object.isRequired,
    contentType: PropTypes.shape({
      attributes: PropTypes.object.isRequired,
      info: PropTypes.shape({ label: PropTypes.string.isRequired }).isRequired,
      layouts: PropTypes.shape({
        list: PropTypes.array.isRequired,
      }).isRequired,
      options: PropTypes.object.isRequired,
      settings: PropTypes.object.isRequired,
    }).isRequired,
  }).isRequired,
  // count: PropTypes.number.isRequired,
  data: PropTypes.array.isRequired,
  // didDeleteData: PropTypes.bool.isRequired,
  // // emitEvent: PropTypes.func.isRequired,
  // entriesToDelete: PropTypes.array.isRequired,
  isLoading: PropTypes.bool.isRequired,
  // layouts: PropTypes.object,
  // location: PropTypes.shape({
  //   pathname: PropTypes.string.isRequired,
  //   search: PropTypes.string.isRequired,
  // }).isRequired,
  // // models: PropTypes.array.isRequired,
  getData: PropTypes.func.isRequired,
  getDataSucceeded: PropTypes.func.isRequired,
  // history: PropTypes.shape({
  //   push: PropTypes.func.isRequired,
  // }).isRequired,
  // onChangeBulk: PropTypes.func.isRequired,
  // onChangeBulkSelectall: PropTypes.func.isRequired,
  onChangeListHeaders: PropTypes.func.isRequired,
  // onDeleteDataError: PropTypes.func.isRequired,
  // onDeleteDataSucceeded: PropTypes.func.isRequired,
  // onDeleteSeveralDataSucceeded: PropTypes.func.isRequired,
  onResetListHeaders: PropTypes.func.isRequired,
  pagination: PropTypes.shape({ total: PropTypes.number.isRequired }).isRequired,
  resetProps: PropTypes.func.isRequired,
  // setModalLoadingState: PropTypes.func.isRequired,
  // showModalConfirmButtonLoading: PropTypes.bool.isRequired,
  // showWarningDelete: PropTypes.bool.isRequired,
  // showWarningDeleteAll: PropTypes.bool.isRequired,
  slug: PropTypes.string.isRequired,
  // toggleModalDelete: PropTypes.func.isRequired,
  // toggleModalDeleteAll: PropTypes.func.isRequired,
  setLayout: PropTypes.func.isRequired,
};

const mapStateToProps = makeSelectListView();

export function mapDispatchToProps(dispatch) {
  return bindActionCreators(
    {
      getData,
      getDataSucceeded,
      onChangeBulk,
      onChangeBulkSelectall,
      onChangeListHeaders,
      onDeleteDataError,
      onDeleteDataSucceeded,
      onDeleteSeveralDataSucceeded,
      onResetListHeaders,
      resetProps,
      setModalLoadingState,
      toggleModalDelete,
      toggleModalDeleteAll,
      setLayout,
    },
    dispatch
  );
}
const withConnect = connect(mapStateToProps, mapDispatchToProps);

export default compose(withConnect)(
  // memo(ListView, (prev, next) => {
  //   console.log(difference(prev, next));

  //   return true;
  // })
  memo(ListView, isEqual)
);
